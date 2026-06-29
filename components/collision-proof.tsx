"use client";

import { useState } from "react";
import { formatCents } from "./format";
import type { DemoRaceResult } from "./demo-types";
import { Money } from "./ui";

// The canned race mirrors the live demo scenario exactly: two $600 purchases against a $1,000
// budget that fits only one. Running it live replaces these with the real numbers from the cluster.
const CANNED: DemoRaceResult = {
  approvedCount: 1,
  blockedCount: 1,
  limitCents: "100000",
  amountCents: "60000",
  finalRemainingCents: "40000",
  loserRetries: 1,
  conflictObserved: true,
  booksBalanced: true,
};

function committedPct(race: DemoRaceResult): number {
  const limit = Number(race.limitCents);
  if (limit <= 0) return 0;
  const spent = limit - Number(race.finalRemainingCents);
  return Math.max(0, Math.min(100, (spent / limit) * 100));
}

function Stat({ label, value, tone = "ink" }: { label: string; value: string; tone?: "ink" | "ok" }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.08em] text-faint">{label}</div>
      <div className={`mt-0.5 text-sm font-medium ${tone === "ok" ? "text-ok" : "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}

// The collision proof. Two purchases race one budget: the committed one fills the budget to its
// share and stops, the loser bounces off the ceiling carrying the 40001 that the database raised
// at commit. This is the one frame that shows the product and the moat at once, so it lives on the
// Overview, not behind a button. The animation restarts on `playKey`; reduced motion shows the
// settled end state through the CSS in globals.css.
export function CollisionProof() {
  const [race, setRace] = useState<DemoRaceResult>(CANNED);
  const [playKey, setPlayKey] = useState(0);
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function replay() {
    setPlayKey((k) => k + 1);
  }

  async function runLive() {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/demo/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenario: "race" }),
      });
      const body = (await response.json().catch(() => null)) as
        | { result?: { race?: DemoRaceResult }; error?: string }
        | null;
      if (!response.ok || !body?.result?.race) {
        throw new Error(body?.error ?? `Request failed with ${response.status}`);
      }
      setRace(body.result.race);
      setLive(true);
      setPlayKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not run the race.");
    } finally {
      setRunning(false);
    }
  }

  const pct = committedPct(race);

  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint">
          Concurrency proof {live ? "· live from the cluster" : ""}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={replay}
            className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-muted hover:text-ink"
          >
            Replay
          </button>
          <button
            type="button"
            onClick={runLive}
            disabled={running}
            className="rounded-md bg-brand px-2.5 py-1 text-xs font-semibold text-canvas hover:opacity-90 disabled:opacity-60"
          >
            {running ? "Running" : "Run it live"}
          </button>
        </div>
      </div>

      {/* The two racing purchases. */}
      <div className="mt-4 flex items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-2.5 py-0.5 font-medium text-ok">
          Agent A · {formatCents(race.amountCents)} committed
        </span>
        <span
          key={`loser-${playKey}`}
          className="collide-loser inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-2.5 py-0.5 font-medium text-danger"
        >
          Agent B · {formatCents(race.amountCents)} blocked
        </span>
      </div>

      {/* The budget bar. The committed purchase fills its share, the dashed ceiling is the limit. */}
      <div className="relative mt-3 h-9 w-full overflow-hidden rounded-lg border border-line bg-raised">
        <div className="absolute inset-0" style={{ width: `${pct}%` }}>
          {/* The committed purchase rushes to fill its share of the budget. The keyframe restarts
              when playKey changes, and reduced motion holds the filled end state. */}
          <div key={`fill-${playKey}`} className="collide-fill h-full rounded-r-md bg-ok/80" />
        </div>
        <div className="absolute inset-y-0 right-0 flex items-center border-l border-dashed border-faint pl-2 pr-2">
          <span className="text-[10px] font-medium uppercase tracking-wide text-faint">
            Limit {formatCents(race.limitCents)}
          </span>
        </div>
      </div>

      {/* The rejection the database raised at commit. */}
      <div
        key={`badge-${playKey}`}
        className="collide-loser mt-3 inline-flex items-center gap-2 rounded-md bg-danger-soft px-2.5 py-1"
      >
        <span className="font-mono text-xs text-danger">OC000 · SQLSTATE 40001</span>
        <span className="text-xs text-muted">→ re-read → blocked</span>
      </div>

      {/* The guarantee, in plain words and exact figures. */}
      <p className="mt-4 text-sm leading-6 text-ink">
        Two agents raced one budget. Aurora DSQL committed exactly one and rejected the other at
        commit as a write-write conflict, so the budget moved once and the books stayed balanced.
      </p>
      <p className="mt-2 text-lg font-semibold tracking-tight">
        <Money cents={race.finalRemainingCents} /> left, not one cent over.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-4">
        <Stat label="Approved" value={String(race.approvedCount)} tone="ok" />
        <Stat label="Blocked" value={String(race.blockedCount)} />
        <Stat label="Rejected at commit" value={race.conflictObserved ? "40001" : "no"} />
        <Stat label="Books balanced" value={race.booksBalanced ? "Yes" : "No"} tone="ok" />
      </div>
      {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
    </div>
  );
}
