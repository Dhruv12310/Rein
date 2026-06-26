import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { CurrentBudgets } from "../components/current-budgets";
import type { SpendResponse } from "../components/types";

const populated: SpendResponse = {
  period: "2026-06",
  agents: [
    {
      id: "a1",
      name: "Analytics Agent",
      status: "active",
      budgets: [
        { id: "b1", category: "data", limitCents: "200000", remainingCents: "125000", spentCents: "75000" },
      ],
    },
  ],
};

describe("CurrentBudgets", () => {
  test("loading state", () => {
    render(<CurrentBudgets status="loading" data={null} error={null} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  test("error state", () => {
    render(<CurrentBudgets status="error" data={null} error="budgets down" />);
    expect(screen.getByRole("alert")).toHaveTextContent("budgets down");
  });

  test("empty state", () => {
    render(<CurrentBudgets status="ok" data={{ period: "2026-06", agents: [] }} error={null} />);
    expect(screen.getByText(/no budgets set/i)).toBeInTheDocument();
  });

  test("populated lists the budget with its limit and remaining", () => {
    render(<CurrentBudgets status="ok" data={populated} error={null} />);
    expect(screen.getByText("Analytics Agent")).toBeInTheDocument();
    expect(screen.getByText("data")).toBeInTheDocument();
    expect(screen.getByText("$2,000.00")).toBeInTheDocument();
    expect(screen.getByText("$1,250.00")).toBeInTheDocument();
  });
});
