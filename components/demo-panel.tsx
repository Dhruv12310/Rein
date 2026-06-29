"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import { formatCents } from "./format";
import { describeReason } from "./reasons";
import type { DemoRaceResult, DemoRunResult, DemoScenario } from "./demo-types";
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  Money,
  Pill,
  SectionLabel,
} from "./ui";

const SCENARIOS: { key: DemoScenario; title: string; description: string }[] = [
  { key: "approved", title: "Approved purchase", description: "A valid, in-budget purchase clears every gate." },
  { key: "wrong-category", title: "Wrong-category block", description: "A category with no room is blocked while another has room." },
  { key: "over-budget", title: "Over-budget block", description: "A purchase larger than the remaining budget is blocked." },
  { key: "race", title: "Concurrent race", description: "Two purchases race one budget. DSQL commits exactly one." },
  { key: "shared-cap", title: "Shared team cap", description: "Two agents under one team budget. DSQL enforces the shared ceiling." },
  { key: "replay", title: "Replay block", description: "The same signed payment cannot be charged twice." },
  { key: "kill-switch", title: "Instant kill-switch", description: "A revoked agent is stopped on its very next decision." },
  { key: "tampered", title: "Tampered mandate block", description: "A changed mandate fails signature verification." },
];

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 tnum font-medium">{children}</dd>
    </div>
  );
}

function RacePanel({ race }: { race: DemoRaceResult }) {
  return (
    <div className="rounded-lg border border-line bg-raised p-4">
      <SectionLabel>What the database did</SectionLabel>
      <p className="mt-2 text-sm leading-6 text-ink">
        Two purchases of {formatCents(race.amountCents)} raced a {formatCents(race.limitCents)} budget
        that fits only one. DSQL detected the write-write conflict at commit and rejected the second,
        so the budget moved exactly once and the books stayed balanced.
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Fact label="Approved">{race.approvedCount}</Fact>
        <Fact label="Blocked">{race.blockedCount}</Fact>
        <Fact label="Budget remaining">
          <Money cents={race.finalRemainingCents} />
        </Fact>
        <Fact label="Rejected at commit">{race.conflictObserved ? "Yes, 40001" : "No"}</Fact>
        <Fact label="Loser retries">{race.loserRetries}</Fact>
        <Fact label="Books balanced">{race.booksBalanced ? "Yes" : "No"}</Fact>
      </dl>
    </div>
  );
}

function DemoResultCard({ result }: { result: DemoRunResult }) {
  const reason = describeReason(result.status, result.machineReason);
  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium">{result.title}</div>
        <Pill tone={result.status === "approved" ? "approved" : reason.group}>
          {result.status === "approved" ? "Approved" : reason.label}
        </Pill>
      </div>
      <p className="text-sm leading-6 text-ink">{result.summary}</p>

      {result.status === "blocked" && result.machineReason ? (
        <div>
          <SectionLabel>Machine reason</SectionLabel>
          <code className="mt-1 block font-mono text-xs text-muted">{result.machineReason}</code>
        </div>
      ) : null}

      {result.race ? (
        <RacePanel race={result.race} />
      ) : (
        <dl className="grid grid-cols-2 gap-4">
          <Fact label="Spend before">
            <Money cents={result.spendBeforeCents ?? "0"} />
          </Fact>
          <Fact label="Spend after">
            <Money cents={result.spendAfterCents ?? "0"} />
          </Fact>
        </dl>
      )}

      {result.status === "approved" && result.transactionId ? (
        <Link
          href={`/activity/${result.transactionId}`}
          className="inline-block text-sm font-medium text-brand hover:underline"
        >
          View the audit chain
        </Link>
      ) : null}
    </Card>
  );
}

export function DemoPanel() {
  const [running, setRunning] = useState<DemoScenario | "reset" | null>(null);
  const [result, setResult] = useState<DemoRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetNote, setResetNote] = useState<string | null>(null);

  async function run(scenario: DemoScenario) {
    setRunning(scenario);
    setError(null);
    setResetNote(null);
    try {
      const response = await fetch("/api/demo/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario }),
      });
      const body = (await response.json().catch(() => null)) as
        | { result?: DemoRunResult; error?: string }
        | null;
      if (!response.ok || !body?.result) {
        throw new Error(body?.error ?? `Request failed with ${response.status}`);
      }
      setResult(body.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The scenario could not run.");
    } finally {
      setRunning(null);
    }
  }

  async function reset() {
    setRunning("reset");
    setError(null);
    try {
      const response = await fetch("/api/demo/reset", { method: "POST" });
      const body = (await response.json().catch(() => null)) as
        | { cleared?: { agents: number; transactions: number }; error?: string }
        | null;
      if (!response.ok || !body?.cleared) {
        throw new Error(body?.error ?? `Request failed with ${response.status}`);
      }
      setResult(null);
      setResetNote(
        `Cleared ${body.cleared.agents} demo agent(s) and ${body.cleared.transactions} transaction(s).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset could not run.");
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-3">
        {SCENARIOS.map((scenario) => (
          <Card key={scenario.key} className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <div className="font-medium">{scenario.title}</div>
              <div className="mt-0.5 text-sm text-muted">{scenario.description}</div>
            </div>
            <button
              type="button"
              onClick={() => run(scenario.key)}
              disabled={running !== null}
              className="shrink-0 rounded-md bg-brand px-3.5 py-2 text-sm font-semibold text-canvas hover:opacity-90 disabled:opacity-60"
            >
              {running === scenario.key ? "Running" : "Run"}
            </button>
          </Card>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={reset}
            disabled={running !== null}
            className="rounded-md border border-line bg-surface px-3.5 py-2 text-sm font-medium hover:bg-raised disabled:opacity-60"
          >
            {running === "reset" ? "Resetting" : "Reset demo data"}
          </button>
          {resetNote ? <span className="text-sm text-muted">{resetNote}</span> : null}
        </div>
      </div>

      <div>
        <SectionLabel>Last run</SectionLabel>
        <div className="mt-3">
          {error ? (
            <ErrorState message={error} />
          ) : running && running !== "reset" ? (
            <LoadingBlock label="Running scenario" rows={3} />
          ) : result ? (
            <DemoResultCard result={result} />
          ) : (
            <EmptyState
              title="No scenario run yet"
              hint="Run a scenario to see exactly what happened, and watch the Overview and Activity tabs update."
            />
          )}
        </div>
      </div>
    </div>
  );
}
