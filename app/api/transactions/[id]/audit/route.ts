import { type NextRequest, NextResponse } from "next/server";
import { auditChain } from "@/lib/queries";
import { toJsonSafe } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Route params are async in this version of Next, so context.params is awaited.
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const chain = await auditChain(id);
    if (!chain) {
      return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
    }
    return NextResponse.json(toJsonSafe(chain));
  } catch (err) {
    console.error("GET /api/transactions/[id]/audit failed", err);
    return NextResponse.json({ error: "Could not load the audit chain." }, { status: 500 });
  }
}
