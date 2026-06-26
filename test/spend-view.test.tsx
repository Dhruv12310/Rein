import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { SpendView } from "../components/spend-view";
import type { SpendResponse } from "../components/types";

const populated: SpendResponse = {
  period: "2026-06",
  agents: [
    {
      id: "a1",
      name: "Procurement Bot",
      status: "active",
      budgets: [
        { id: "b1", category: null, limitCents: "500000", remainingCents: "350000", spentCents: "150000" },
        { id: "b2", category: "cloud", limitCents: "250000", remainingCents: "0", spentCents: "250000" },
      ],
    },
  ],
};

describe("SpendView", () => {
  test("loading state", () => {
    render(<SpendView status="loading" data={null} error={null} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  test("error state", () => {
    render(<SpendView status="error" data={null} error="cluster unreachable" />);
    expect(screen.getByRole("alert")).toHaveTextContent("cluster unreachable");
  });

  test("empty state", () => {
    render(<SpendView status="ok" data={{ period: "2026-06", agents: [] }} error={null} />);
    expect(screen.getByText(/no budgets yet/i)).toBeInTheDocument();
  });

  test("populated shows the agent, its categories, money to the cent, and a meter per budget", () => {
    render(<SpendView status="ok" data={populated} error={null} />);
    expect(screen.getByText("Procurement Bot")).toBeInTheDocument();
    expect(screen.getByText("Overall cap")).toBeInTheDocument();
    expect(screen.getByText("cloud")).toBeInTheDocument();
    expect(screen.getByText("$1,500.00")).toBeInTheDocument();
    expect(screen.getAllByRole("meter")).toHaveLength(2);
  });

  test("a later poll failure keeps the data on screen with a reconnecting notice", () => {
    render(<SpendView status="error" data={populated} error="blip" />);
    expect(screen.getByText("Procurement Bot")).toBeInTheDocument();
    expect(screen.getByText(/reconnecting/i)).toBeInTheDocument();
  });
});
