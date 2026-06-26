import { afterAll, describe, expect, test } from "vitest";
import { closePool } from "../lib/db";
import { currentPeriod, purchase } from "../lib/purchase";
import {
  cleanup,
  createAgent,
  createBudget,
  ledgerEntriesFor,
  makeBarrier,
  remainingCents,
  sumCents,
  transactionRow,
} from "./helpers";

afterAll(async () => {
  await closePool();
});

describe("purchase, single transaction decisions", () => {
  test("approves a purchase that fits and writes two balanced ledger entries", async () => {
    const period = currentPeriod();
    const agentId = await createAgent();
    const budgetId = await createBudget({ agentId, period, category: null, limitCents: 10_000n });
    const transactionIds: string[] = [];
    try {
      const decision = await purchase({
        agentId,
        amountCents: 2_500n,
        category: "saas",
        vendor: "Acme",
      });
      transactionIds.push(decision.transactionId);

      expect(decision.status).toBe("approved");
      expect(decision.retries).toBe(0);
      expect(await remainingCents(budgetId)).toBe(7_500n);

      const row = await transactionRow(decision.transactionId);
      expect(row?.status).toBe("approved");
      expect(row?.amount_cents).toBe("2500");

      const entries = await ledgerEntriesFor([decision.transactionId]);
      expect(entries).toHaveLength(2);
      const debits = entries.filter((entry) => entry.direction === "debit");
      const credits = entries.filter((entry) => entry.direction === "credit");
      expect(debits).toHaveLength(1);
      expect(credits).toHaveLength(1);
      expect(sumCents(debits)).toBe(2_500n);
      expect(sumCents(credits)).toBe(2_500n);
    } finally {
      await cleanup({ agentId, budgetIds: [budgetId], transactionIds });
    }
  });

  test("blocks an over-budget purchase, records it, and leaves the budget untouched", async () => {
    const period = currentPeriod();
    const agentId = await createAgent();
    const budgetId = await createBudget({ agentId, period, category: null, limitCents: 1_000n });
    const transactionIds: string[] = [];
    try {
      const decision = await purchase({
        agentId,
        amountCents: 5_000n,
        category: "saas",
        vendor: "Acme",
      });
      transactionIds.push(decision.transactionId);

      expect(decision.status).toBe("blocked");
      if (decision.status === "blocked") {
        expect(decision.reason).toMatch(/exceeds/);
      }
      expect(await remainingCents(budgetId)).toBe(1_000n);
      expect(await ledgerEntriesFor([decision.transactionId])).toHaveLength(0);
      expect((await transactionRow(decision.transactionId))?.status).toBe("blocked");
    } finally {
      await cleanup({ agentId, budgetIds: [budgetId], transactionIds });
    }
  });

  test("blocks a purchase in a category with no room even when another category has room", async () => {
    const period = currentPeriod();
    const agentId = await createAgent();
    const saasBudget = await createBudget({
      agentId,
      period,
      category: "saas",
      limitCents: 5_000n,
      remainingCents: 0n,
    });
    const cloudBudget = await createBudget({
      agentId,
      period,
      category: "cloud",
      limitCents: 100_000n,
    });
    const transactionIds: string[] = [];
    try {
      const decision = await purchase({
        agentId,
        amountCents: 1_000n,
        category: "saas",
        vendor: "Acme",
      });
      transactionIds.push(decision.transactionId);

      expect(decision.status).toBe("blocked");
      expect(await remainingCents(saasBudget)).toBe(0n);
      expect(await remainingCents(cloudBudget)).toBe(100_000n); // the unrelated category is untouched
      expect(await ledgerEntriesFor([decision.transactionId])).toHaveLength(0);
    } finally {
      await cleanup({ agentId, budgetIds: [saasBudget, cloudBudget], transactionIds });
    }
  });

  test("blocks a purchase when no budget applies to its category", async () => {
    const period = currentPeriod();
    const agentId = await createAgent();
    const cloudBudget = await createBudget({
      agentId,
      period,
      category: "cloud",
      limitCents: 100_000n,
    });
    const transactionIds: string[] = [];
    try {
      const decision = await purchase({
        agentId,
        amountCents: 1_000n,
        category: "saas",
        vendor: "Acme",
      });
      transactionIds.push(decision.transactionId);

      expect(decision.status).toBe("blocked");
      if (decision.status === "blocked") {
        expect(decision.reason).toMatch(/no budget/);
      }
      expect(await remainingCents(cloudBudget)).toBe(100_000n);
    } finally {
      await cleanup({ agentId, budgetIds: [cloudBudget], transactionIds });
    }
  });
});

describe("purchase, the concurrency guarantee", () => {
  test("two concurrent purchases on one budget: exactly one commits, the loser is blocked", async () => {
    const period = currentPeriod();
    const agentId = await createAgent();
    // Overall cap that fits either purchase alone but not both together.
    const budgetId = await createBudget({ agentId, period, category: null, limitCents: 10_000n });
    const amount = 6_000n;
    const transactionIds: string[] = [];
    try {
      // Hold both transactions after they have read room, then release them into the budget
      // update together so the write-write conflict happens every run, not just on lucky timing.
      const barrier = makeBarrier(2);
      const [first, second] = await Promise.all([
        purchase(
          { agentId, amountCents: amount, category: "saas", vendor: "Acme" },
          { afterRead: barrier },
        ),
        purchase(
          { agentId, amountCents: amount, category: "saas", vendor: "Acme" },
          { afterRead: barrier },
        ),
      ]);
      transactionIds.push(first.transactionId, second.transactionId);

      const approved = [first, second].filter((decision) => decision.status === "approved");
      const blocked = [first, second].filter((decision) => decision.status === "blocked");
      const observedRetries = first.retries + second.retries;
      console.log(
        `[race] approved=${approved.length} blocked=${blocked.length} observedRetries=${observedRetries}`,
      );

      expect(approved).toHaveLength(1);
      expect(blocked).toHaveLength(1);
      expect(await remainingCents(budgetId)).toBe(10_000n - amount);
      // the loser hit a 40001 and re-ran at least once
      expect(observedRetries).toBeGreaterThanOrEqual(1);

      // The books balance: two entries for the single approved purchase, debits equal credits.
      const entries = await ledgerEntriesFor(transactionIds);
      expect(entries).toHaveLength(2);
      expect(sumCents(entries.filter((entry) => entry.direction === "debit"))).toBe(
        sumCents(entries.filter((entry) => entry.direction === "credit")),
      );
    } finally {
      await cleanup({ agentId, budgetIds: [budgetId], transactionIds });
    }
  });
});
