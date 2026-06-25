import { NextResponse } from "next/server";
import { runHealthCheck } from "@/lib/health";

// Raw Postgres needs a real TCP socket, so this handler runs on the Node.js runtime, never
// the Edge runtime. force-dynamic keeps it from being cached: a health check must hit the
// cluster every time.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const health = await runHealthCheck();
    return NextResponse.json(health);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
