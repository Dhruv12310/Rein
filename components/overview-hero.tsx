import { CollisionProof } from "./collision-proof";
import { spendRatio } from "./format";
import type { OverviewStats } from "./types";
import { Card, Money, SectionLabel, StaleNotice } from "./ui";

function Check() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// The first thing on screen: one dominant remaining figure, the live no-overspend proof, and the
// collision that makes the database's role visible. The per-agent breakdown is demoted below this.
export function OverviewHero({
  stats,
  period,
  stale,
}: {
  stats: OverviewStats;
  period: string;
  stale?: boolean;
}) {
  const pct = Math.round(spendRatio(stats.totalSpentCents, stats.totalLimitCents) * 100);
  const clean = stats.overspentBudgets === 0;

  return (
    <div>
      {stale ? <StaleNotice /> : null}
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="p-5 lg:col-span-7">
          <SectionLabel>Remaining across all budgets · {period}</SectionLabel>
          <div className="mt-2 text-4xl font-semibold tracking-tight">
            <Money cents={stats.totalRemainingCents} />
          </div>
          <div className="mt-2 text-sm text-muted">
            <Money cents={stats.totalSpentCents} className="text-ink" /> spent of{" "}
            <Money cents={stats.totalLimitCents} /> across {stats.budgetCount} budgets
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-raised">
            <div className="fill h-full rounded-full bg-brand" style={{ width: `${Math.max(2, pct)}%` }} />
          </div>
        </Card>

        <Card className="grid grid-cols-2 gap-4 p-5 lg:col-span-5">
          <div>
            <SectionLabel>Decisions enforced</SectionLabel>
            <div className="mt-2 text-3xl font-semibold tnum">{stats.decisions.total}</div>
            <div className="mt-1 text-xs text-faint">
              {stats.decisions.approved} approved · {stats.decisions.blocked} blocked
            </div>
          </div>
          <div>
            <SectionLabel>Budgets overspent</SectionLabel>
            <div
              className={`mt-2 flex items-center gap-2 text-3xl font-semibold tnum ${clean ? "text-ok" : "text-danger"}`}
            >
              {clean ? <Check /> : null}
              {stats.overspentBudgets}
            </div>
            <div className="mt-1 text-xs text-faint">
              {clean ? "never, under every race" : "investigate immediately"}
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <CollisionProof />
      </div>
    </div>
  );
}
