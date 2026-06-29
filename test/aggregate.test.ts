import { describe, expect, test } from "vitest";
import { aggregateSpend, type AgentSpend } from "../lib/queries";

// The headline totals must not double count. A purchase decrements both an agent's overall cap and
// its matching category budget, so summing every row would count the same money twice. The overall
// cap already contains the categories, so it stands in for the agent when present.

function budget(category: string | null, limit: string, remaining: string) {
  return {
    id: `b-${category ?? "cap"}`,
    category,
    limitCents: limit,
    remainingCents: remaining,
    spentCents: (BigInt(limit) - BigInt(remaining)).toString(),
  };
}

describe("aggregateSpend", () => {
  test("an agent with an overall cap is counted by the cap, not the cap plus its categories", () => {
    const agents: AgentSpend[] = [
      {
        id: "a1",
        name: "Procurement Bot",
        status: "active",
        budgets: [
          budget(null, "500000", "368000"), // overall cap, 1320 spent
          budget("cloud", "250000", "147000"),
          budget("saas", "150000", "121000"),
        ],
      },
    ];
    const totals = aggregateSpend(agents);
    // The cap is the truth: limit 5000, remaining 3680, spent 1320. Not 9000 / 6360.
    expect(totals.totalLimitCents).toBe("500000");
    expect(totals.totalRemainingCents).toBe("368000");
    expect(totals.totalSpentCents).toBe("132000");
    expect(totals.budgetCount).toBe(3);
  });

  test("an agent with no overall cap sums its non-overlapping category budgets", () => {
    const agents: AgentSpend[] = [
      {
        id: "a2",
        name: "Research Assistant",
        status: "active",
        budgets: [budget("saas", "80000", "68000")],
      },
    ];
    const totals = aggregateSpend(agents);
    expect(totals.totalLimitCents).toBe("80000");
    expect(totals.totalRemainingCents).toBe("68000");
    expect(totals.totalSpentCents).toBe("12000");
  });

  test("totals add up across agents without double counting", () => {
    const agents: AgentSpend[] = [
      {
        id: "a1",
        name: "Procurement Bot",
        status: "active",
        budgets: [budget(null, "500000", "368000"), budget("cloud", "250000", "147000")],
      },
      {
        id: "a2",
        name: "Research Assistant",
        status: "active",
        budgets: [budget("saas", "80000", "68000")],
      },
    ];
    const totals = aggregateSpend(agents);
    expect(totals.totalLimitCents).toBe("580000"); // 5000 cap + 800 saas
    expect(totals.totalRemainingCents).toBe("436000"); // 3680 + 680
    expect(totals.totalSpentCents).toBe("144000"); // 1320 + 120
    expect(totals.budgetCount).toBe(3);
  });

  test("no budgets gives zeroes, not NaN", () => {
    expect(aggregateSpend([])).toEqual({
      totalLimitCents: "0",
      totalRemainingCents: "0",
      totalSpentCents: "0",
      budgetCount: 0,
    });
  });
});
