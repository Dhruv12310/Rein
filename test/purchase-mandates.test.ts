import { afterAll, expect, test } from "vitest";
import { contentHash } from "../lib/canonical";
import { closePool } from "../lib/db";
import type { MandateBundle } from "../lib/mandates";
import { currentPeriod, purchase } from "../lib/purchase";
import { generateKeyPair, signMandate } from "../lib/signing";
import {
  cleanup,
  countMandatesForAgent,
  createAgent,
  createBudget,
  ledgerEntriesFor,
  loadMandateChainForTransaction,
  remainingCents,
  sumCents,
  transactionRow,
} from "./helpers";
import { makeActors, validBundle, type Actors } from "./mandate-fixtures";

afterAll(async () => {
  await closePool();
});

const MANDATE_REASONS = [
  "unknown_signer",
  "invalid_signature",
  "broken_chain",
  "amount_mismatch",
  "purchase_mismatch",
  "agent_mismatch",
  "amount_exceeds_intent",
  "category_not_allowed",
  "vendor_not_allowed",
  "expired_intent",
];

type Buy = { amountCents: bigint; category: string; vendor: string };
type MakeBundle = (actors: Actors, buy: Buy) => MandateBundle;

// Every mandate rejection behaves the same way: the purchase is blocked and recorded with the
// specific reason, it never retries (a mandate failure is not a 40001), no chain is persisted,
// and the budget is untouched. This runs that shape for one tampered or out-of-scope bundle.
async function expectBlockedByMandate(makeBundle: MakeBundle, expectedReason: string): Promise<void> {
  const period = currentPeriod();
  const agentId = await createAgent();
  const actors = makeActors(agentId);
  // Ample room, so the only thing that can block the purchase is the mandate gate.
  const budgetId = await createBudget({ agentId, period, category: null, limitCents: 1_000_000n });
  const transactionIds: string[] = [];
  try {
    const buy: Buy = { amountCents: 5_000n, category: "saas", vendor: "Acme" };
    const decision = await purchase(
      { agentId, ...buy, mandates: makeBundle(actors, buy) },
      { resolveKey: actors.resolveKey },
    );
    transactionIds.push(decision.transactionId);

    expect(decision.status).toBe("blocked");
    if (decision.status === "blocked") {
      expect(decision.reason).toBe(expectedReason);
    }
    expect(decision.retries).toBe(0); // a mandate failure must never drive the OCC retry
    expect(await remainingCents(budgetId)).toBe(1_000_000n); // budget untouched
    expect(await ledgerEntriesFor([decision.transactionId])).toHaveLength(0);
    expect(await countMandatesForAgent(agentId)).toBe(0); // no chain persisted for a block
    expect((await transactionRow(decision.transactionId))?.status).toBe("blocked");
  } finally {
    await cleanup({ agentId, budgetIds: [budgetId], transactionIds });
  }
}

test("valid chain with budget room: approved, chain persisted and linked, ledger balanced", async () => {
  const period = currentPeriod();
  const agentId = await createAgent();
  const actors = makeActors(agentId);
  const budgetId = await createBudget({ agentId, period, category: null, limitCents: 10_000n });
  const transactionIds: string[] = [];
  try {
    const buy: Buy = { amountCents: 4_000n, category: "saas", vendor: "Acme" };
    const bundle = validBundle(actors, buy);
    const decision = await purchase(
      { agentId, ...buy, mandates: bundle },
      { resolveKey: actors.resolveKey },
    );
    transactionIds.push(decision.transactionId);

    expect(decision.status).toBe("approved");
    expect(await remainingCents(budgetId)).toBe(6_000n);

    // The three mandate rows persist, linked payment to cart to intent.
    expect(await countMandatesForAgent(agentId)).toBe(3);
    const chain = await loadMandateChainForTransaction(decision.transactionId);
    expect(chain.payment?.type).toBe("payment");
    expect(chain.cart?.type).toBe("cart");
    expect(chain.intent?.type).toBe("intent");
    expect(chain.payment?.parent_mandate_id).toBe(chain.cart?.id);
    expect(chain.cart?.parent_mandate_id).toBe(chain.intent?.id);
    expect(chain.intent?.parent_mandate_id).toBeNull();

    // The stored content hashes match a fresh recompute, so the chain is tamper-evident.
    expect(chain.intent?.content_hash).toBe(contentHash(bundle.intent.content));
    expect(chain.cart?.content_hash).toBe(contentHash(bundle.cart.content));
    expect(chain.payment?.content_hash).toBe(contentHash(bundle.payment.content));

    const entries = await ledgerEntriesFor([decision.transactionId]);
    expect(entries).toHaveLength(2);
    expect(sumCents(entries.filter((entry) => entry.direction === "debit"))).toBe(
      sumCents(entries.filter((entry) => entry.direction === "credit")),
    );
  } finally {
    await cleanup({ agentId, budgetIds: [budgetId], transactionIds });
  }
});

test("tampered intent is blocked on signature", async () => {
  await expectBlockedByMandate((actors, buy) => {
    const bundle = validBundle(actors, buy);
    bundle.intent.content.max_amount_cents = "999999999"; // changed after signing
    return bundle;
  }, "invalid_signature");
});

test("a mandate signed by the wrong key is blocked", async () => {
  await expectBlockedByMandate((actors, buy) => {
    const bundle = validBundle(actors, buy);
    const stranger = generateKeyPair();
    bundle.payment = signMandate(bundle.payment.content, stranger.privateKey);
    return bundle;
  }, "invalid_signature");
});

test("a broken chain is blocked", async () => {
  await expectBlockedByMandate((actors, buy) => {
    const bundle = validBundle(actors, buy);
    bundle.payment = signMandate(
      { ...bundle.payment.content, cart_hash: "0".repeat(64) },
      actors.agentKey,
    );
    return bundle;
  }, "broken_chain");
});

test("an expired intent is blocked", async () => {
  await expectBlockedByMandate(
    (actors, buy) => validBundle(actors, buy, { notAfter: new Date(Date.now() - 60_000) }),
    "expired_intent",
  );
});

test("an amount over the intent cap is blocked", async () => {
  await expectBlockedByMandate(
    (actors, buy) => validBundle(actors, buy, { maxAmountCents: buy.amountCents - 1n }),
    "amount_exceeds_intent",
  );
});

test("a category outside the intent is blocked", async () => {
  await expectBlockedByMandate(
    (actors, buy) => validBundle(actors, buy, { allowedCategories: ["cloud"] }),
    "category_not_allowed",
  );
});

test("a vendor outside the intent is blocked", async () => {
  await expectBlockedByMandate(
    (actors, buy) => validBundle(actors, buy, { vendorAllowlist: ["OtherVendor"] }),
    "vendor_not_allowed",
  );
});

test("independence: a valid mandate but an over-budget purchase is blocked by the budget gate", async () => {
  const period = currentPeriod();
  const agentId = await createAgent();
  const actors = makeActors(agentId);
  // Mandate allows the spend, the budget does not. The budget gate must be what blocks it.
  const budgetId = await createBudget({ agentId, period, category: null, limitCents: 1_000n });
  const transactionIds: string[] = [];
  try {
    const buy: Buy = { amountCents: 5_000n, category: "saas", vendor: "Acme" };
    const bundle = validBundle(actors, buy, { maxAmountCents: 1_000_000n });
    const decision = await purchase(
      { agentId, ...buy, mandates: bundle },
      { resolveKey: actors.resolveKey },
    );
    transactionIds.push(decision.transactionId);

    expect(decision.status).toBe("blocked");
    if (decision.status === "blocked") {
      expect(decision.reason).toMatch(/exceeds remaining/); // the budget reason, not a mandate reason
      expect(MANDATE_REASONS).not.toContain(decision.reason);
    }
    expect(await remainingCents(budgetId)).toBe(1_000n); // untouched
    expect(await ledgerEntriesFor([decision.transactionId])).toHaveLength(0);
    expect(await countMandatesForAgent(agentId)).toBe(0); // a block persists no chain
  } finally {
    await cleanup({ agentId, budgetIds: [budgetId], transactionIds });
  }
});
