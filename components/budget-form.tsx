"use client";

import { type FormEvent, useState } from "react";
import { dollarsToCents } from "./format";
import type { AgentRow } from "./types";

type Submission =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

// The limit is typed in dollars and converted to an exact cent string before it crosses the
// boundary, so the writer only ever sees integer cents. An empty category means the overall cap.
export function BudgetForm({
  agents,
  period,
  onSaved,
}: {
  agents: AgentRow[];
  period: string;
  onSaved: () => void;
}) {
  const [agentId, setAgentId] = useState("");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState("");
  const [submission, setSubmission] = useState<Submission>({ kind: "idle" });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!agentId) {
      setSubmission({ kind: "error", message: "Choose an agent." });
      return;
    }
    const limitCents = dollarsToCents(limit);
    if (limitCents === null) {
      setSubmission({ kind: "error", message: "Enter a limit like 1500 or 1500.00." });
      return;
    }

    setSubmission({ kind: "saving" });
    try {
      const response = await fetch("/api/budgets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId,
          period,
          category: category.trim() === "" ? null : category.trim(),
          limitCents,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed with ${response.status}`);
      }
      setSubmission({ kind: "ok", message: "Budget saved." });
      setLimit("");
      setCategory("");
      onSaved();
    } catch (err) {
      setSubmission({ kind: "error", message: err instanceof Error ? err.message : "Could not save." });
    }
  }

  const field = "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm";
  const label = "mb-1.5 block text-sm font-medium";

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className={label} htmlFor="budget-agent">
          Agent
        </label>
        <select
          id="budget-agent"
          className={field}
          value={agentId}
          onChange={(event) => setAgentId(event.target.value)}
        >
          <option value="">Select an agent</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={label} htmlFor="budget-category">
          Category <span className="font-normal text-faint">(leave blank for an overall cap)</span>
        </label>
        <input
          id="budget-category"
          className={field}
          value={category}
          placeholder="cloud, saas, data"
          onChange={(event) => setCategory(event.target.value)}
        />
      </div>

      <div>
        <label className={label} htmlFor="budget-limit">
          Monthly limit
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-faint">
            $
          </span>
          <input
            id="budget-limit"
            inputMode="decimal"
            className={`${field} pl-7 tnum`}
            value={limit}
            placeholder="1500.00"
            onChange={(event) => setLimit(event.target.value)}
          />
        </div>
        <p className="mt-1.5 text-xs text-faint">Period {period}</p>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={submission.kind === "saving"}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-canvas hover:opacity-90 disabled:opacity-60"
        >
          {submission.kind === "saving" ? "Saving" : "Save budget"}
        </button>
        {submission.kind === "ok" ? (
          <span className="text-sm text-ok" role="status">
            {submission.message}
          </span>
        ) : null}
        {submission.kind === "error" ? (
          <span className="text-sm text-danger" role="alert">
            {submission.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
