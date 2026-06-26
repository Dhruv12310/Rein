import { type NextRequest, NextResponse } from "next/server";
import { currentPeriod } from "@/lib/purchase";
import { spendSummary } from "@/lib/queries";
import { toJsonSafe } from "@/lib/serialize";

// Raw Postgres needs the Node runtime, and a live view must never be cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const period = request.nextUrl.searchParams.get("period") ?? currentPeriod();
    const agents = await spendSummary(period);
    return NextResponse.json(toJsonSafe({ period, agents }));
  } catch (err) {
    console.error("GET /api/spend failed", err);
    return NextResponse.json({ error: "Could not load spend." }, { status: 500 });
  }
}
