import { type NextRequest, NextResponse } from "next/server";
import { isDemoScenario, runDemoScenario } from "@/lib/demo";
import { toJsonSafe } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  const scenario = (body as { scenario?: unknown } | null)?.scenario;
  if (!isDemoScenario(scenario)) {
    return NextResponse.json({ error: "Unknown scenario." }, { status: 400 });
  }

  try {
    const result = await runDemoScenario(scenario);
    return NextResponse.json(toJsonSafe({ result }));
  } catch (err) {
    console.error(`POST /api/demo/run (${scenario}) failed`, err);
    return NextResponse.json({ error: "The scenario could not run." }, { status: 500 });
  }
}
