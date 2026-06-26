// Format a decimal cent string as currency without going through a float, so the exact cents the
// API sent are the cents shown. Money crosses the boundary as a string for this reason.
export function formatCents(cents: string): string {
  const negative = cents.startsWith("-");
  const digits = (negative ? cents.slice(1) : cents).padStart(3, "0");
  const dollars = digits.slice(0, -2);
  const fraction = digits.slice(-2);
  const grouped = dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${grouped}.${fraction}`;
}

// Fraction of a budget that is spent, clamped to the bar's range. Used only for the fill width
// and the health color, never for a displayed money value, so Number is fine here.
export function spendRatio(spentCents: string, limitCents: string): number {
  const limit = Number(limitCents);
  if (!Number.isFinite(limit) || limit <= 0) {
    return spentCents !== "0" ? 1 : 0;
  }
  return Math.max(0, Math.min(1, Number(spentCents) / limit));
}

export type Health = "ok" | "warn" | "exhausted";

export function healthOf(spentCents: string, limitCents: string): Health {
  const limit = Number(limitCents);
  const ratio = limit > 0 ? Number(spentCents) / limit : spentCents !== "0" ? 1 : 0;
  if (ratio >= 1) {
    return "exhausted";
  }
  if (ratio >= 0.75) {
    return "warn";
  }
  return "ok";
}

// A compact relative time for the feed. now is a parameter so the formatting is testable.
export function formatRelative(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) {
    return "";
  }
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.round(hours / 24)}d ago`;
}

export function shortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

// The current budget period as budgets store it, computed client-side so a form has a period
// before any data loads. UTC to match how the server resolves it.
export function currentMonthPeriod(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Turn a dollars input ("1500" or "1500.50") into an exact cent string for the API, or null if it
// is not a plain money amount. Stays string math so nothing rounds.
export function dollarsToCents(input: string): string | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return null;
  }
  const [whole, fraction = ""] = cleaned.split(".");
  const cents = `${whole}${fraction.padEnd(2, "0")}`;
  return cents.replace(/^0+(?=\d)/, "");
}
