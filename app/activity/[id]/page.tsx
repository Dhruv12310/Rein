"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AuditView } from "@/components/audit-view";
import type { AuditChain } from "@/components/types";
import { PageHeader } from "@/components/ui";
import { usePolling } from "@/components/use-polling";

export default function AuditPage() {
  const params = useParams<{ id: string }>();
  // One-shot: a committed chain never changes, so there is nothing to poll.
  const poll = usePolling<AuditChain>(`/api/transactions/${params.id}/audit`, 0);
  return (
    <div>
      <PageHeader
        title="Audit trail"
        description="The signed mandate chain behind this purchase."
        actions={
          <Link href="/activity" className="text-sm text-muted hover:text-ink">
            Back to activity
          </Link>
        }
      />
      <AuditView status={poll.status} data={poll.data} error={poll.error} onRetry={poll.refresh} />
    </div>
  );
}
