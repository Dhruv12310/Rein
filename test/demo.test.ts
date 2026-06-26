import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { closePool, getPool } from "../lib/db";
import { resetDemo, runDemoScenario } from "../lib/demo";

// Each scenario seeds its own demo-namespaced state and runs through the real purchase path. The
// reset clears demo data between tests, so each test starts clean and leaves nothing behind.
beforeAll(async () => {
  await resetDemo();
});
afterEach(async () => {
  await resetDemo();
});
afterAll(async () => {
  await closePool();
});

test("approved: a valid in-budget purchase is approved and moves the budget by the amount", async () => {
  const result = await runDemoScenario("approved");
  expect(result.status).toBe("approved");
  expect(result.machineReason).toBeNull();
  expect(result.transactionId).not.toBeNull();
  expect(BigInt(result.spendAfterCents ?? "0") - BigInt(result.spendBeforeCents ?? "0")).toBe(45_000n);
});

test("wrong-category: a purchase is blocked on its category budget while another has room", async () => {
  const result = await runDemoScenario("wrong-category");
  expect(result.status).toBe("blocked");
  expect(result.machineReason).toMatch(/exceeds remaining/);
  expect(result.spendBeforeCents).toBe(result.spendAfterCents); // the budget did not move
});

test("over-budget: a purchase larger than remaining is blocked and the budget does not move", async () => {
  const result = await runDemoScenario("over-budget");
  expect(result.status).toBe("blocked");
  expect(result.machineReason).toMatch(/exceeds remaining/);
  expect(result.spendBeforeCents).toBe(result.spendAfterCents);
});

test("race: exactly one commits, the loser is rejected at commit with a conflict, books balance", async () => {
  const result = await runDemoScenario("race");
  if (!result.race) {
    throw new Error("expected a race result");
  }
  expect(result.race.approvedCount).toBe(1);
  expect(result.race.blockedCount).toBe(1);
  // DSQL rejected the second write at commit, observed as a real 40001 retry on the loser.
  expect(result.race.conflictObserved).toBe(true);
  expect(result.race.loserRetries).toBeGreaterThanOrEqual(1);
  // The budget moved exactly once, and the books stayed balanced.
  expect(result.race.finalRemainingCents).toBe((100_000n - 60_000n).toString());
  expect(result.race.booksBalanced).toBe(true);
});

test("replay: the second submission of the same payment is blocked as already redeemed", async () => {
  const result = await runDemoScenario("replay");
  expect(result.status).toBe("blocked");
  expect(result.machineReason).toBe("payment_already_redeemed");
  expect(result.spendBeforeCents).toBe(result.spendAfterCents); // the replay did not move the budget
});

test("tampered: a mandate changed after signing is blocked on its signature", async () => {
  const result = await runDemoScenario("tampered");
  expect(result.status).toBe("blocked");
  expect(result.machineReason).toBe("invalid_signature");
  expect(result.spendBeforeCents).toBe(result.spendAfterCents);
});

test("reset clears only demo data and leaves non-demo data untouched", async () => {
  const pool = getPool();
  const nonDemoBefore = Number(
    (
      await pool.query<{ count: string }>(
        "SELECT count(*) AS count FROM agents WHERE name NOT LIKE 'demo: %'",
      )
    ).rows[0].count,
  );

  await runDemoScenario("approved");
  await runDemoScenario("race");

  const demoCount = Number(
    (
      await pool.query<{ count: string }>(
        "SELECT count(*) AS count FROM agents WHERE name LIKE 'demo: %'",
      )
    ).rows[0].count,
  );
  expect(demoCount).toBeGreaterThan(0);

  const cleared = await resetDemo();
  expect(cleared.agents).toBeGreaterThan(0);

  const demoAfter = Number(
    (
      await pool.query<{ count: string }>(
        "SELECT count(*) AS count FROM agents WHERE name LIKE 'demo: %'",
      )
    ).rows[0].count,
  );
  expect(demoAfter).toBe(0);

  const nonDemoAfter = Number(
    (
      await pool.query<{ count: string }>(
        "SELECT count(*) AS count FROM agents WHERE name NOT LIKE 'demo: %'",
      )
    ).rows[0].count,
  );
  expect(nonDemoAfter).toBe(nonDemoBefore);
});
