import type { SpendResponse } from "./types";
import type { PollStatus } from "./use-polling";
import { EmptyState, ErrorState, LoadingBlock, Money, StaleNotice } from "./ui";

// The compact list of budgets on the config page, with the same loading, empty, and error states
// as the spend view it shares data with. Pure, so each state is rendered straight from props.
export function CurrentBudgets({
  status,
  data,
  error,
  onRetry,
}: {
  status: PollStatus;
  data: SpendResponse | null;
  error: string | null;
  onRetry?: () => void;
}) {
  if (status === "loading" && !data) {
    return <LoadingBlock label="Loading budgets" rows={3} />;
  }
  if (status === "error" && !data) {
    return <ErrorState message={error ?? "Could not load budgets."} onRetry={onRetry} />;
  }
  const agents = (data?.agents ?? []).filter((agent) => agent.budgets.length > 0);
  if (agents.length === 0) {
    return <EmptyState title="No budgets set" hint="Use the form to add the first one." />;
  }
  return (
    <div className="space-y-5">
      {status === "error" ? <StaleNotice /> : null}
      {agents.map((agent) => (
        <div key={agent.id}>
          <div className="text-sm font-medium">{agent.name}</div>
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
            {agent.budgets.map((budget) => (
              <li
                key={budget.id}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
              >
                <span className="text-muted">{budget.category ?? "Overall cap"}</span>
                <span className="tnum text-right">
                  <Money cents={budget.limitCents} /> <span className="text-faint">limit</span>
                  <span className="mx-1.5 text-faint">/</span>
                  <Money cents={budget.remainingCents} /> <span className="text-faint">left</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
