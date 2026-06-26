"use client";

import { SpendView } from "@/components/spend-view";
import type { SpendResponse } from "@/components/types";
import { PageHeader } from "@/components/ui";
import { usePolling } from "@/components/use-polling";

export default function OverviewPage() {
  const poll = usePolling<SpendResponse>("/api/spend", 4000);
  return (
    <div>
      <PageHeader
        title="Live spend"
        description={
          poll.data
            ? `Budgets and spend for ${poll.data.period}`
            : "Budgets and spend for the current period"
        }
      />
      <SpendView status={poll.status} data={poll.data} error={poll.error} onRetry={poll.refresh} />
    </div>
  );
}
