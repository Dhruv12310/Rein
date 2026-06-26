import type { SpendResponse } from "./types";
import type { PollStatus } from "./use-polling";
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingBlock,
  SectionLabel,
  SpendBar,
  StaleNotice,
} from "./ui";

// Pure view so its loading, empty, error, and populated states are each rendered straight from
// props in a test. The container does the polling and hands the state down.
export function SpendView({
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
    return <LoadingBlock label="Loading spend" rows={3} />;
  }
  if (status === "error" && !data) {
    return <ErrorState message={error ?? "Could not load spend."} onRetry={onRetry} />;
  }

  const agents = (data?.agents ?? []).filter((agent) => agent.budgets.length > 0);
  if (agents.length === 0) {
    return (
      <EmptyState
        title="No budgets yet"
        hint="Set a budget on the Budgets tab to start tracking spend."
      />
    );
  }

  return (
    <div className="space-y-6">
      {status === "error" ? <StaleNotice /> : null}
      {agents.map((agent) => (
        <Card key={agent.id} className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="font-medium">{agent.name}</div>
            <SectionLabel>{agent.status}</SectionLabel>
          </div>
          <div className="space-y-4">
            {agent.budgets.map((budget) => (
              <div key={budget.id}>
                <div className="mb-1.5 text-sm text-muted">{budget.category ?? "Overall cap"}</div>
                <SpendBar
                  spentCents={budget.spentCents}
                  limitCents={budget.limitCents}
                  remainingCents={budget.remainingCents}
                />
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
