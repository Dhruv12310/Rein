import Link from "next/link";
import { formatRelative } from "./format";
import { describeReason } from "./reasons";
import type { FeedResponse } from "./types";
import type { PollStatus } from "./use-polling";
import { Card, EmptyState, ErrorState, LoadingBlock, Money, Pill, StaleNotice } from "./ui";

// One stream of approved and blocked purchases. The pill color says which gate decided the
// purchase, and a blocked row keeps its machine reason in small mono text so the data stays
// faithful while the label stays readable. Approved rows link to their audit chain.
export function FeedView({
  status,
  data,
  error,
  onRetry,
  now,
}: {
  status: PollStatus;
  data: FeedResponse | null;
  error: string | null;
  onRetry?: () => void;
  now?: number;
}) {
  if (status === "loading" && !data) {
    return <LoadingBlock label="Loading activity" rows={5} />;
  }
  if (status === "error" && !data) {
    return <ErrorState message={error ?? "Could not load activity."} onRetry={onRetry} />;
  }

  const transactions = data?.transactions ?? [];
  if (transactions.length === 0) {
    return (
      <EmptyState title="No activity yet" hint="Purchases appear here as agents spend." />
    );
  }

  return (
    <>
      {status === "error" ? <StaleNotice /> : null}
      <Card className="divide-y divide-line">
        {transactions.map((txn) => {
        const reason = describeReason(txn.status, txn.reason);
        const body = (
          <div className="flex items-center justify-between gap-4 px-5 py-3.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={reason.group}>{reason.label}</Pill>
                {txn.category ? (
                  <span className="truncate text-sm text-muted">{txn.category}</span>
                ) : null}
              </div>
              <div className="mt-1 flex items-center gap-2 text-sm text-muted">
                <span className="truncate">{txn.vendor ?? "unknown vendor"}</span>
                {txn.status === "blocked" && reason.machine ? (
                  <span className="truncate font-mono text-xs text-faint">{reason.machine}</span>
                ) : null}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <Money cents={txn.amountCents} className="font-medium" />
              <div className="mt-1 text-xs text-faint">{formatRelative(txn.createdAt, now)}</div>
            </div>
          </div>
        );

        if (txn.status === "approved") {
          return (
            <Link
              key={txn.id}
              href={`/activity/${txn.id}`}
              className="block transition-colors hover:bg-raised"
            >
              {body}
            </Link>
          );
        }
        return <div key={txn.id}>{body}</div>;
      })}
      </Card>
    </>
  );
}
