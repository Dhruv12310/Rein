import { NextResponse } from "next/server";
import { listAgents } from "@/lib/queries";
import { toJsonSafe } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const agents = await listAgents();
    return NextResponse.json(toJsonSafe({ agents }));
  } catch (err) {
    console.error("GET /api/agents failed", err);
    return NextResponse.json({ error: "Could not load agents." }, { status: 500 });
  }
}
