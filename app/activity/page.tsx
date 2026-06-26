"use client";

import { FeedView } from "@/components/feed-view";
import type { FeedResponse } from "@/components/types";
import { PageHeader } from "@/components/ui";
import { usePolling } from "@/components/use-polling";

export default function ActivityPage() {
  const poll = usePolling<FeedResponse>("/api/transactions?limit=60", 4000);
  return (
    <div>
      <PageHeader
        title="Activity"
        description="Every purchase, approved or blocked, as it happens."
      />
      <FeedView status={poll.status} data={poll.data} error={poll.error} onRetry={poll.refresh} />
    </div>
  );
}
