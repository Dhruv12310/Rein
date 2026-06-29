"use client";

import { OverviewHero } from "@/components/overview-hero";
import { SpendView } from "@/components/spend-view";
import type { OverviewResponse } from "@/components/types";
import { ErrorState, LoadingBlock, PageHeader, SectionLabel } from "@/components/ui";
import { usePolling } from "@/components/use-polling";

export default function OverviewPage() {
  const poll = usePolling<OverviewResponse>("/api/overview", 4000);

  return (
    <div>
      <PageHeader
        title="Live spend"
        description={
          poll.data
            ? `Budgets, spend, and the no-overspend guarantee for ${poll.data.period}`
            : "Budgets, spend, and the no-overspend guarantee"
        }
      />

      {!poll.data && poll.status === "loading" ? (
        <LoadingBlock label="Loading spend" rows={3} />
      ) : !poll.data && poll.status === "error" ? (
        <ErrorState message={poll.error ?? "Could not load spend."} onRetry={poll.refresh} />
      ) : poll.data ? (
        <>
          <OverviewHero
            stats={poll.data.stats}
            period={poll.data.period}
            stale={poll.status === "error"}
          />
          <div className="mt-10">
            <SectionLabel>By agent</SectionLabel>
            <div className="mt-3">
              <SpendView status="ok" data={poll.data} error={null} />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
