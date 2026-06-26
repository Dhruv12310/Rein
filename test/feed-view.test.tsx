import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";

// next/link needs the App Router runtime, which the test does not have, so render a plain anchor.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { FeedView } from "../components/feed-view";
import type { FeedResponse } from "../components/types";

const fixedNow = Date.parse("2026-06-26T01:00:10.000Z");

const populated: FeedResponse = {
  transactions: [
    {
      id: "t1",
      amountCents: "62000",
      category: "cloud",
      vendor: "Acme Cloud",
      status: "approved",
      reason: null,
      createdAt: "2026-06-26T01:00:00.000Z",
    },
    {
      id: "t2",
      amountCents: "90000",
      category: "saas",
      vendor: "Contoso",
      status: "blocked",
      reason: "amount exceeds remaining on category saas",
      createdAt: "2026-06-26T01:00:05.000Z",
    },
    {
      id: "t3",
      amountCents: "22000",
      category: "data",
      vendor: "Northwind Data",
      status: "blocked",
      reason: "payment_already_redeemed",
      createdAt: "2026-06-26T01:00:06.000Z",
    },
  ],
};

describe("FeedView", () => {
  test("loading state", () => {
    render(<FeedView status="loading" data={null} error={null} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  test("error state", () => {
    render(<FeedView status="error" data={null} error="feed down" />);
    expect(screen.getByRole("alert")).toHaveTextContent("feed down");
  });

  test("empty state", () => {
    render(<FeedView status="ok" data={{ transactions: [] }} error={null} />);
    expect(screen.getByText(/no activity yet/i)).toBeInTheDocument();
  });

  test("populated shows human-readable block reasons by gate, keeps the machine reason, and links approved rows", () => {
    render(<FeedView status="ok" data={populated} error={null} now={fixedNow} />);
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByText("Over budget")).toBeInTheDocument();
    expect(screen.getByText("Already charged")).toBeInTheDocument();
    // the machine reason is still in the data shown to an auditor
    expect(screen.getByText("payment_already_redeemed")).toBeInTheDocument();
    expect(screen.getByText("$620.00")).toBeInTheDocument();
    // only the approved row links to its audit chain
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/activity/t1");
  });
});
