import type { ReactNode } from "react";
import { formatCents, healthOf, spendRatio } from "./format";

export function Money({ cents, className = "" }: { cents: string; className?: string }) {
  return <span className={`tnum ${className}`}>{formatCents(cents)}</span>;
}

const PILL_TONES = {
  approved: "bg-ok-soft text-ok",
  budget: "bg-warn-soft text-warn",
  mandate: "bg-danger-soft text-danger",
  replay: "bg-replay-soft text-replay",
  neutral: "bg-raised text-muted",
  brand: "bg-brand-soft text-brand",
} as const;

export type PillTone = keyof typeof PILL_TONES;

// A glyph per tone, so an approved or blocked state never depends on color alone. Drawn with
// currentColor so each icon inherits its pill's text color.
function PillIcon({ tone }: { tone: PillTone }) {
  const common = {
    width: 12,
    height: 12,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (tone === "approved") {
    return (
      <svg {...common}>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (tone === "budget") {
    return (
      <svg {...common}>
        <path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      </svg>
    );
  }
  if (tone === "mandate") {
    return (
      <svg {...common}>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10ZM9.5 9.5l5 5M14.5 9.5l-5 5" />
      </svg>
    );
  }
  if (tone === "replay") {
    return (
      <svg {...common}>
        <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
      </svg>
    );
  }
  return null;
}

export function Pill({ tone = "neutral", children }: { tone?: PillTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${PILL_TONES[tone]}`}
    >
      <PillIcon tone={tone} />
      {children}
    </span>
  );
}

export function LiveDot() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />
      Live
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-surface ${className}`}>{children}</div>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-faint">{children}</div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
    </header>
  );
}

export function LoadingBlock({ label = "Loading", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-busy="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="h-16 animate-pulse rounded-xl border border-line bg-raised" />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-raised px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-line bg-danger-soft px-6 py-8 text-center" role="alert">
      <p className="text-sm font-medium text-danger">Something went wrong</p>
      <p className="mt-1 text-sm text-muted">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-raised"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

// Shown above stale data when a poll has started failing but the last good data is still on
// screen, so a finance reviewer is never shown old figures as if they were current.
export function StaleNotice() {
  return (
    <div className="mb-3 rounded-md bg-warn-soft px-3 py-2 text-xs text-warn" role="status">
      Reconnecting. Showing the last update.
    </div>
  );
}

const HEALTH_FILL = {
  ok: "bg-ok",
  warn: "bg-warn",
  exhausted: "bg-danger",
} as const;

// The spend bar is where the concurrency story is visible. The fill width is the share of the
// limit already spent, colored by health, and the CSS transition means a purchase landing during
// a poll reads as the bar moving rather than a number quietly changing.
export function SpendBar({
  spentCents,
  limitCents,
  remainingCents,
}: {
  spentCents: string;
  limitCents: string;
  remainingCents: string;
}) {
  const health = healthOf(spentCents, limitCents);
  const pct = Math.round(spendRatio(spentCents, limitCents) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="tnum font-medium">
          {formatCents(spentCents)} <span className="text-faint">/ {formatCents(limitCents)}</span>
        </span>
        <span className="tnum text-muted">{formatCents(remainingCents)} left</span>
      </div>
      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-raised"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`${pct}% of limit spent`}
      >
        <div
          className={`fill h-full rounded-full ${HEALTH_FILL[health]}`}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
    </div>
  );
}
