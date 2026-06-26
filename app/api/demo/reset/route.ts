import { NextResponse } from "next/server";
import { resetDemo } from "@/lib/demo";
import { toJsonSafe } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const cleared = await resetDemo();
    return NextResponse.json(toJsonSafe({ cleared }));
  } catch (err) {
    console.error("POST /api/demo/reset failed", err);
    return NextResponse.json({ error: "Reset could not run." }, { status: 500 });
  }
}
