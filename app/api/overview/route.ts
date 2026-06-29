import { type NextRequest, NextResponse } from "next/server";
import { currentPeriod } from "@/lib/purchase";
import { aggregateSpend, integrityStats, spendSummary } from "@/lib/queries";
import { toJsonSafe } from "@/lib/serialize";

// One poll for the whole Overview: the per-agent spend, the headline totals derived from those same
// rows so the hero and the breakdown agree, and the live no-overspend proof counters.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const period = request.nextUrl.searchParams.get("period") ?? currentPeriod();
    const [agents, integrity] = await Promise.all([
      spendSummary(period),
      integrityStats(period),
    ]);
    const stats = { ...aggregateSpend(agents), ...integrity };
    return NextResponse.json(toJsonSafe({ period, stats, agents }));
  } catch (err) {
    console.error("GET /api/overview failed", err);
    return NextResponse.json({ error: "Could not load the overview." }, { status: 500 });
  }
}
