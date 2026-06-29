import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { closePool } from "../lib/db";
import { resetDemo, runDemoScenario } from "../lib/demo";

// These run the two new scenarios through the real purchase path against the live cluster, with the
// demo reset isolating each test. They are separate from the Phase 4 demo tests so those stay as
// they were.
beforeAll(async () => {
  await resetDemo();
});
afterEach(async () => {
  await resetDemo();
});
afterAll(async () => {
  await closePool();
});

test("shared team cap: two agents racing one team budget, exactly one commits, conflict observed, cap exact", async () => {
  const result = await runDemoScenario("shared-cap");
  if (!result.race) {
    throw new Error("expected a race result");
  }
  // Different agents, but the shared team ceiling let exactly one through.
  expect(result.race.approvedCount).toBe(1);
  expect(result.race.blockedCount).toBe(1);
  // DSQL rejected the second write to the shared team row at commit.
  expect(result.race.conflictObserved).toBe(true);
  expect(result.race.loserRetries).toBeGreaterThanOrEqual(1);
  // The team cap moved exactly once and the books balanced.
  expect(result.race.finalRemainingCents).toBe((100_000n - 60_000n).toString());
  expect(result.race.booksBalanced).toBe(true);
});

test("kill-switch: a revoked agent is blocked on its next decision with agent_revoked, no money moves", async () => {
  const result = await runDemoScenario("kill-switch");
  expect(result.status).toBe("blocked");
  expect(result.machineReason).toBe("agent_revoked");
  // The revoked purchase carried a valid mandate and had budget, so only the revocation stopped it,
  // and it did so before any spend.
  expect(result.spendBeforeCents).toBe(result.spendAfterCents);
});
