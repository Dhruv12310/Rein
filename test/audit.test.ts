import { afterAll, expect, test } from "vitest";
import { contentHash } from "../lib/canonical";
import { closePool } from "../lib/db";
import { currentPeriod, purchase } from "../lib/purchase";
import { auditChain } from "../lib/queries";
import { cleanup, createAgent, createBudget } from "./helpers";
import { makeActors, validBundle } from "./mandate-fixtures";

afterAll(async () => {
  await closePool();
});

test("auditChain returns the full linked intent, cart, and payment for an approved transaction", async () => {
  const period = currentPeriod();
  const agentId = await createAgent();
  const actors = makeActors(agentId);
  const budgetId = await createBudget({ agentId, period, category: null, limitCents: 50_000n });
  const buy = { amountCents: 4_000n, category: "saas", vendor: "Acme" };
  const bundle = validBundle(actors, buy);
  const transactionIds: string[] = [];
  try {
    const decision = await purchase(
      { agentId, ...buy, mandates: bundle },
      { resolveKey: actors.resolveKey },
    );
    transactionIds.push(decision.transactionId);
    expect(decision.status).toBe("approved");

    const chain = await auditChain(decision.transactionId);
    if (!chain) {
      throw new Error("expected an audit chain");
    }

    expect(chain.intent?.type).toBe("intent");
    expect(chain.cart?.type).toBe("cart");
    expect(chain.payment?.type).toBe("payment");

    // Linked payment to cart to intent.
    expect(chain.payment?.parentMandateId).toBe(chain.cart?.id);
    expect(chain.cart?.parentMandateId).toBe(chain.intent?.id);
    expect(chain.intent?.parentMandateId).toBeNull();

    // The stored hashes match a fresh recompute of the signed content.
    expect(chain.intent?.contentHash).toBe(contentHash(bundle.intent.content));
    expect(chain.cart?.contentHash).toBe(contentHash(bundle.cart.content));
    expect(chain.payment?.contentHash).toBe(contentHash(bundle.payment.content));

    expect(chain.transaction.amountCents).toBe("4000");
  } finally {
    await cleanup({ agentId, budgetIds: [budgetId], transactionIds });
  }
});
