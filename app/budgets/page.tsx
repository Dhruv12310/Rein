"use client";

import { BudgetForm } from "@/components/budget-form";
import { CurrentBudgets } from "@/components/current-budgets";
import { currentMonthPeriod } from "@/components/format";
import type { AgentsResponse, SpendResponse } from "@/components/types";
import { Card, EmptyState, ErrorState, LoadingBlock, PageHeader, SectionLabel } from "@/components/ui";
import { usePolling } from "@/components/use-polling";

export default function BudgetsPage() {
  const agentsPoll = usePolling<AgentsResponse>("/api/agents", 0);
  const spendPoll = usePolling<SpendResponse>("/api/spend", 0);
  const period = spendPoll.data?.period ?? currentMonthPeriod();
  const refresh = () => {
    agentsPoll.refresh();
    spendPoll.refresh();
  };

  return (
    <div>
      <PageHeader
        title="Budgets"
        description="Set a monthly limit per agent and category. Saving the same one again adjusts it, never duplicates it."
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Card className="p-5">
            <SectionLabel>Set a budget</SectionLabel>
            <div className="mt-4">
              {agentsPoll.status === "loading" && !agentsPoll.data ? (
                <LoadingBlock label="Loading agents" rows={3} />
              ) : agentsPoll.status === "error" && !agentsPoll.data ? (
                <ErrorState
                  message={agentsPoll.error ?? "Could not load agents."}
                  onRetry={agentsPoll.refresh}
                />
              ) : (agentsPoll.data?.agents ?? []).length === 0 ? (
                <EmptyState title="No agents yet" hint="Seed the demo data to add agents." />
              ) : (
                <BudgetForm
                  agents={agentsPoll.data?.agents ?? []}
                  period={period}
                  onSaved={refresh}
                />
              )}
            </div>
          </Card>
        </div>
        <div className="lg:col-span-3">
          <Card className="p-5">
            <SectionLabel>Current budgets, {period}</SectionLabel>
            <div className="mt-4">
              <CurrentBudgets
                status={spendPoll.status}
                data={spendPoll.data}
                error={spendPoll.error}
                onRetry={spendPoll.refresh}
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
