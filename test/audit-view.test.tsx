import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { AuditView } from "../components/audit-view";
import type { AuditChain } from "../components/types";

const createdAt = "2026-06-26T01:00:00.000Z";

const chain: AuditChain = {
  transaction: {
    id: "t1",
    amountCents: "4000",
    category: "saas",
    vendor: "Acme",
    status: "approved",
    reason: null,
    createdAt,
  },
  intent: {
    id: "i1",
    type: "intent",
    parentMandateId: null,
    contentHash: "hash-intent",
    signature: "sig-intent",
    scope: { principal_id: "p", max_amount_cents: "10000" },
    createdAt,
  },
  cart: {
    id: "c1",
    type: "cart",
    parentMandateId: "i1",
    contentHash: "hash-cart",
    signature: "sig-cart",
    scope: { amount_cents: "4000" },
    createdAt,
  },
  payment: {
    id: "pay1",
    type: "payment",
    parentMandateId: "c1",
    contentHash: "hash-payment",
    signature: "sig-payment",
    scope: { amount_cents: "4000" },
    createdAt,
  },
};

describe("AuditView", () => {
  test("loading state", () => {
    render(<AuditView status="loading" data={null} error={null} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  test("error state", () => {
    render(<AuditView status="error" data={null} error="audit down" />);
    expect(screen.getByRole("alert")).toHaveTextContent("audit down");
  });

  test("not found when there is no chain", () => {
    render(<AuditView status="ok" data={null} error={null} />);
    expect(screen.getByText(/not found/i)).toBeInTheDocument();
  });

  test("populated walks intent, cart, payment with their hashes and signatures", () => {
    render(<AuditView status="ok" data={chain} error={null} />);
    expect(screen.getByText("Signed by the principal")).toBeInTheDocument();
    expect(screen.getByText("Signed by the vendor")).toBeInTheDocument();
    expect(screen.getByText("Signed by the agent")).toBeInTheDocument();
    expect(screen.getByText("hash-intent")).toBeInTheDocument();
    expect(screen.getByText("hash-cart")).toBeInTheDocument();
    expect(screen.getByText("hash-payment")).toBeInTheDocument();
    expect(screen.getByText("sig-payment")).toBeInTheDocument();
  });
});
