import { afterAll, expect, test } from "vitest";
import { closePool } from "../lib/db";
import { currentPeriod, purchase } from "../lib/purchase";
import {
  cleanup,
  createAgent,
  createBudget,
  ledgerEntriesFor,
  remainingCents,
  sumCents,
} from "./helpers";
import { makeActors, validBundle } from "./mandate-fixtures";

afterAll(async () => {
  await closePool();
});

test("load: N concurrent purchases against a budget that allows exactly K", async () => {
  const period = currentPeriod();
  const agentId = await createAgent();
  const actors = makeActors(agentId);
  const n = 10;
  const k = 4;
  const amount = 5_000n;
  const buy = { amountCents: amount, category: "saas", vendor: "Acme" };
  // Room for exactly K purchases of this amount, so N minus K must be blocked.
  const budgetId = await createBudget({
    agentId,
    period,
    category: null,
    limitCents: amount * BigInt(k),
  });
  const transactionIds: string[] = [];
  try {
    // Worst case, a single purchase loses one race per committed decrement on the contended
    // row, which is exactly K times and is independent of N. After that it re-reads zero room
    // and rejects cleanly with no further conflict. So K plus a small margin as the attempt cap
    // never exhausts retries here, which would otherwise be a false failure.
    const maxAttempts = k + 8;
    const requests = Array.from({ length: n }, () =>
      purchase(
        { agentId, ...buy, mandates: validBundle(actors, buy) },
        { maxAttempts, resolveKey: actors.resolveKey },
      ),
    );

    const started = performance.now();
    const decisions = await Promise.all(requests);
    const elapsedMs = performance.now() - started;

    for (const decision of decisions) {
      transactionIds.push(decision.transactionId);
    }
    const approved = decisions.filter((decision) => decision.status === "approved");
    const blocked = decisions.filter((decision) => decision.status === "blocked");
    const observedRetries = decisions.reduce((sum, decision) => sum + decision.retries, 0);
    console.log(
      `[load] N=${n} K=${k} approved=${approved.length} blocked=${blocked.length} ` +
        `observedRetries=${observedRetries} wallMs=${elapsedMs.toFixed(1)} ` +
        `perCallAvgMs=${(elapsedMs / n).toFixed(1)}`,
    );

    expect(approved).toHaveLength(k);
    expect(blocked).toHaveLength(n - k);
    expect(await remainingCents(budgetId)).toBe(0n);
    // observedRetries is logged above as a contention signal, not asserted: without a barrier
    // the exact count depends on commit-time interleaving. The deterministic 40001 proof lives
    // in the barriered race test. The counts and the exact final balance are the real guarantee.

    // The books balance: two entries per approved purchase, debits equal credits, and the total
    // debited equals exactly the K approved amounts.
    const entries = await ledgerEntriesFor(transactionIds);
    expect(entries).toHaveLength(2 * k);
    const debits = sumCents(entries.filter((entry) => entry.direction === "debit"));
    const credits = sumCents(entries.filter((entry) => entry.direction === "credit"));
    expect(debits).toBe(credits);
    expect(debits).toBe(amount * BigInt(k));
  } finally {
    await cleanup({ agentId, budgetIds: [budgetId], transactionIds });
  }
}, 120_000);

test("perf: single purchase latency against the live cluster, warm", async () => {
  const period = currentPeriod();
  const agentId = await createAgent();
  const actors = makeActors(agentId);
  const budgetId = await createBudget({ agentId, period, category: null, limitCents: 10_000_000n });
  const transactionIds: string[] = [];
  try {
    // Warm the pool first so the one-time token mint and TLS handshake do not skew the sample.
    const warmBuy = { amountCents: 1n, category: "saas", vendor: "warmup" };
    const warm = await purchase(
      { agentId, ...warmBuy, mandates: validBundle(actors, warmBuy) },
      { resolveKey: actors.resolveKey },
    );
    transactionIds.push(warm.transactionId);

    const samples: number[] = [];
    const buy = { amountCents: 100n, category: "saas", vendor: "perf" };
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      const decision = await purchase(
        { agentId, ...buy, mandates: validBundle(actors, buy) },
        { resolveKey: actors.resolveKey },
      );
      samples.push(performance.now() - started);
      transactionIds.push(decision.transactionId);
    }

    const avg = samples.reduce((sum, value) => sum + value, 0) / samples.length;
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    console.log(
      `[perf] singlePurchaseMs avg=${avg.toFixed(1)} min=${min.toFixed(1)} max=${max.toFixed(1)} ` +
        `samples=[${samples.map((value) => value.toFixed(0)).join(", ")}]`,
    );

    expect(samples).toHaveLength(5);
  } finally {
    await cleanup({ agentId, budgetIds: [budgetId], transactionIds });
  }
});
