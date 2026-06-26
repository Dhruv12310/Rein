import { type NextRequest, NextResponse } from "next/server";
import { transactionFeed } from "@/lib/queries";
import { toJsonSafe } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const raw = Number(request.nextUrl.searchParams.get("limit"));
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 200) : 50;
    const transactions = await transactionFeed(limit);
    return NextResponse.json(toJsonSafe({ transactions }));
  } catch (err) {
    console.error("GET /api/transactions failed", err);
    return NextResponse.json({ error: "Could not load the transaction feed." }, { status: 500 });
  }
}
