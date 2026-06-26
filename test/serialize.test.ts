import { describe, expect, test } from "vitest";
import { toJsonSafe } from "../lib/serialize";

describe("the money boundary", () => {
  test("an API payload with BigInt money serializes without throwing and round-trips to exact cents", () => {
    const payload = {
      period: "2026-06",
      agents: [
        {
          id: "agent-1",
          // 2^53 + 1, the first integer a JS number cannot hold exactly, to prove the boundary
          // keeps cents exact instead of going through a float.
          remainingCents: 9_007_199_254_740_993n,
          budgets: [{ limitCents: 1_234_567_890_123_456_789n }],
        },
      ],
    };

    // Raw serialization throws on a BigInt, which is exactly why the boundary helper exists.
    expect(() => JSON.stringify(payload)).toThrow();

    const json = JSON.stringify(toJsonSafe(payload));
    const parsed = JSON.parse(json);

    expect(parsed.agents[0].remainingCents).toBe("9007199254740993");
    expect(parsed.agents[0].budgets[0].limitCents).toBe("1234567890123456789");
    // Exact to the cent on the way back, which a number would not be.
    expect(BigInt(parsed.agents[0].remainingCents)).toBe(9_007_199_254_740_993n);
    expect(BigInt(parsed.agents[0].budgets[0].limitCents)).toBe(1_234_567_890_123_456_789n);
  });

  test("a Date becomes an ISO string and other values pass through", () => {
    const safe = toJsonSafe({
      createdAt: new Date("2026-06-26T01:00:00.000Z"),
      category: null,
      vendor: "Acme",
      count: 3,
    });
    expect(safe).toEqual({
      createdAt: "2026-06-26T01:00:00.000Z",
      category: null,
      vendor: "Acme",
      count: 3,
    });
  });
});
