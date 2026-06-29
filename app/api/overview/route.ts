import { type NextRequest, NextResponse } from "next/server";
import { currentPeriod } from "@/lib/purchase";
import { overviewStats, spendSummary } from "@/lib/queries";
import { toJsonSafe } from "@/lib/serialize";

// One poll for the whole Overview: the per-agent spend plus the header totals and the live
// no-overspend proof, so the hero and the breakdown stay consistent and the page makes one request.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const period = request.nextUrl.searchParams.get("period") ?? currentPeriod();
    const [agents, stats] = await Promise.all([spendSummary(period), overviewStats(period)]);
    return NextResponse.json(toJsonSafe({ period, stats, agents }));
  } catch (err) {
    console.error("GET /api/overview failed", err);
    return NextResponse.json({ error: "Could not load the overview." }, { status: 500 });
  }
}
