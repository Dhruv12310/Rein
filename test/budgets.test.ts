import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { budgetId, setBudget } from "../lib/budgets";
import { closePool, getPool } from "../lib/db";

afterAll(async () => {
  await closePool();
});

async function countBudgets(agentId: string): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    "SELECT count(*) AS count FROM budgets WHERE agent_id = $1",
    [agentId],
  );
  return Number(rows[0].count);
}

async function removeBudgets(agentId: string): Promise<void> {
  await getPool().query("DELETE FROM budgets WHERE agent_id = $1", [agentId]);
}

test("setting the same agent, period, and category twice updates the one row, never duplicates", async () => {
  const agentId = randomUUID();
  const period = "2026-06";
  try {
    const first = await setBudget({ agentId, period, category: "cloud", limitCents: 100_000n });
    const second = await setBudget({ agentId, period, category: "cloud", limitCents: 150_000n });

    expect(second.id).toBe(first.id);
    expect(second.id).toBe(budgetId(agentId, period, "cloud"));
    expect(await countBudgets(agentId)).toBe(1);
    expect(second.limit_cents).toBe("150000");
    // Nothing was spent, so raising the limit moves remaining by the same delta to its new full.
    expect(second.remaining_cents).toBe("150000");
  } finally {
    await removeBudgets(agentId);
  }
});

test("a concurrent double-set of the same budget resolves to exactly one row", async () => {
  const agentId = randomUUID();
  const period = "2026-06";
  try {
    const [a, b] = await Promise.all([
      setBudget({ agentId, period, category: null, limitCents: 200_000n }),
      setBudget({ agentId, period, category: null, limitCents: 200_000n }),
    ]);
    expect(a.id).toBe(b.id);
    expect(await countBudgets(agentId)).toBe(1);
  } finally {
    await removeBudgets(agentId);
  }
});

test("a limit cannot be lowered below current spend; remaining floors at zero and stays consistent", async () => {
  const agentId = randomUUID();
  const period = "2026-06";
  try {
    const created = await setBudget({ agentId, period, category: "data", limitCents: 200_000n });
    // Simulate 150000 already spent by drawing remaining down directly.
    await getPool().query("UPDATE budgets SET remaining_cents = 50000 WHERE id = $1", [created.id]);
    // Try to lower the limit to 100000, below the 150000 already spent.
    const updated = await setBudget({ agentId, period, category: "data", limitCents: 100_000n });
    // The limit floors at the spent amount and remaining floors at zero, never negative.
    expect(updated.remaining_cents).toBe("0");
    expect(updated.limit_cents).toBe("150000");
    // The identity holds: spent equals limit minus remaining.
    expect(BigInt(updated.limit_cents) - BigInt(updated.remaining_cents)).toBe(150_000n);
  } finally {
    await removeBudgets(agentId);
  }
});

test("budgetId is deterministic and keeps a null overall cap distinct from an empty category", () => {
  const agentId = "agent-x";
  expect(budgetId(agentId, "2026-06", "cloud")).toBe(budgetId(agentId, "2026-06", "cloud"));
  expect(budgetId(agentId, "2026-06", null)).not.toBe(budgetId(agentId, "2026-06", ""));
  expect(budgetId(agentId, "2026-06", "cloud")).not.toBe(budgetId(agentId, "2026-06", "saas"));
});
