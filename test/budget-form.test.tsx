import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { BudgetForm } from "../components/budget-form";

const agents = [
  { id: "a1", name: "Procurement Bot", status: "active" },
  { id: "a2", name: "Analytics Agent", status: "active" },
];

describe("BudgetForm", () => {
  test("renders the agent options, the limit field, and the period", () => {
    render(<BudgetForm agents={agents} period="2026-06" onSaved={() => {}} />);
    expect(screen.getByRole("option", { name: "Procurement Bot" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Analytics Agent" })).toBeInTheDocument();
    expect(screen.getByLabelText(/monthly limit/i)).toBeInTheDocument();
    expect(screen.getByText("Period 2026-06")).toBeInTheDocument();
  });

  test("blocks saving until an agent is chosen", async () => {
    render(<BudgetForm agents={agents} period="2026-06" onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /save budget/i }));
    expect(await screen.findByText("Choose an agent.")).toBeInTheDocument();
  });
});
