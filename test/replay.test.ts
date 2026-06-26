import { afterAll, expect, test } from "vitest";
import { contentHash } from "../lib/canonical";
import { closePool } from "../lib/db";
import { currentPeriod, purchase } from "../lib/purchase";
import {
  cleanup,
  countMandatesForAgent,
  createAgent,
  createBudget,
  ledgerEntriesFor,
  makeBarrier,
  paymentRedeemed,
  remainingCents,
  setRemaining,
  sumCents,
} from "./helpers";
import { makeActors, validBundle } from "./mandate-fixtures";

afterAll(async () => {
  await closePool();
});

test("a redeemed payment cannot be redeemed again, even with budget room", async () => {
  const period = currentPeriod();
  const agentId = await createAgent();
  const actors = makeActors(agentId);
  // Room for two purchases, so only single use, not the budget, can stop the replay.
  const budgetId = await createBudget({ agentId, period, category: null, limitCents: 10_000n });
  const buy = { amountCents: 3_000n, category: "saas", vendor: "Acme" };
  const bundle = validBundle(actors, buy);
  const paymentHash = contentHash(bundle.payment.content);
  const transactionIds: string[] = [];
  try {
    const first = await purchase(
      { agentId, ...buy, mandates: bundle },
      { resolveKey: actors.resolveKey },
    );
    const second = await purchase(
      { agentId, ...buy, mandates: bundle }, // the identical signed bundle
      { resolveKey: actors.resolveKey },
    );
    transactionIds.push(first.transactionId, second.transactionId);

    expect(first.status).toBe("approved");
    expect(second.status).toBe("blocked");
    if (second.status === "blocked") {
      expect(second.reason).toBe("payment_already_redeemed");
    }
    // A sequential replay collides on the committed primary key directly, no 40001, no retry.
    expect(second.retries).toBe(0);

    // Exactly one purchase moved money.
    expect(await remainingCents(budgetId)).toBe(7_000n);
    expect(await paymentRedeemed(paymentHash)).toBe(true);
    expect(await countMandatesForAgent(agentId)).toBe(3); // only the first chain persisted

    const entries = await ledgerEntriesFor(transactionIds);
    expect(entries).toHaveLength(2);
    expect(sumCents(entries.filter((entry) => entry.direction === "debit"))).toBe(
      sumCents(entries.filter((entry) => entry.direction === "credit")),
    );
  } finally {
    await cleanup({ agentId, budgetIds: [budgetId], transactionIds });
  }
});

test("two concurrent redemptions of one payment resolve to exactly one charge", async () => {
  const period = currentPeriod();
  const agentId = await createAgent();
  const actors = makeActors(agentId);
  // Room for both, so the budget cannot be what blocks the second one.
  const budgetId = await createBudget({ agentId, period, category: null, limitCents: 10_000n });
  const buy = { amountCents: 3_000n, category: "saas", vendor: "Acme" };
  const bundle = validBundle(actors, buy);
  const transactionIds: string[] = [];
  try {
    // Release both into the writes together so they collide at commit, the 40001 path that then
    // resolves to a 23505 replay on the retry.
    const barrier = makeBarrier(2);
    const [a, b] = await Promise.all([
      purchase(
        { agentId, ...buy, mandates: bundle },
        { resolveKey: actors.resolveKey, afterRead: barrier },
      ),
      purchase(
        { agentId, ...buy, mandates: bundle },
        { resolveKey: actors.resolveKey, afterRead: barrier },
      ),
    ]);
    transactionIds.push(a.transactionId, b.transactionId);

    const approved = [a, b].filter((decision) => decision.status === "approved");
    const blocked = [a, b].filter((decision) => decision.status === "blocked");
    const observedRetries = a.retries + b.retries;
    console.log(
      `[replay] approved=${approved.length} blocked=${blocked.length} observedRetries=${observedRetries}`,
    );

    expect(approved).toHaveLength(1);
    expect(blocked).toHaveLength(1);
    expect(blocked[0].status === "blocked" && blocked[0].reason).toBe("payment_already_redeemed");
    // The loser saw the concurrent 40001 and re-ran into the committed-replay path.
    expect(observedRetries).toBeGreaterThanOrEqual(1);

    expect(await remainingCents(budgetId)).toBe(7_000n); // one purchase only
    expect(await countMandatesForAgent(agentId)).toBe(3); // one chain persisted

    const entries = await ledgerEntriesFor(transactionIds);
    expect(entries).toHaveLength(2);
    expect(sumCents(entries.filter((entry) => entry.direction === "debit"))).toBe(
      sumCents(entries.filter((entry) => entry.direction === "credit")),
    );
  } finally {
    await cleanup({ agentId, budgetIds: [budgetId], transactionIds });
  }
});

test("a purchase blocked on budget does not consume the payment, and the same bundle later succeeds", async () => {
  const period = currentPeriod();
  const agentId = await createAgent();
  const actors = makeActors(agentId);
  // Start with too little room, so the first attempt is blocked on budget.
  const budgetId = await createBudget({ agentId, period, category: null, limitCents: 1_000n });
  const buy = { amountCents: 5_000n, category: "saas", vendor: "Acme" };
  const bundle = validBundle(actors, buy);
  const paymentHash = contentHash(bundle.payment.content);
  const transactionIds: string[] = [];
  try {
    const blockedDecision = await purchase(
      { agentId, ...buy, mandates: bundle },
      { resolveKey: actors.resolveKey },
    );
    transactionIds.push(blockedDecision.transactionId);

    expect(blockedDecision.status).toBe("blocked");
    if (blockedDecision.status === "blocked") {
      expect(blockedDecision.reason).toMatch(/exceeds remaining/); // blocked on budget, not replay
    }
    // The payment was not spent, so it is still available.
    expect(await paymentRedeemed(paymentHash)).toBe(false);

    // Open room and submit the identical bundle again.
    await setRemaining(budgetId, 5_000n);
    const approvedDecision = await purchase(
      { agentId, ...buy, mandates: bundle },
      { resolveKey: actors.resolveKey },
    );
    transactionIds.push(approvedDecision.transactionId);

    expect(approvedDecision.status).toBe("approved");
    expect(await paymentRedeemed(paymentHash)).toBe(true);
    expect(await remainingCents(budgetId)).toBe(0n);
  } finally {
    await cleanup({ agentId, budgetIds: [budgetId], transactionIds });
  }
});
