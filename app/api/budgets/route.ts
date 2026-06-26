import { type NextRequest, NextResponse } from "next/server";
import { setBudget } from "@/lib/budgets";
import { toJsonSafe } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParsedBudget = {
  agentId: string;
  period: string;
  category: string | null;
  limitCents: bigint;
};

// Validate the write at the boundary. The limit arrives as a decimal cent string, the same way
// money leaves, so nothing is parsed through a float. An empty or missing category is the overall
// cap, stored as null.
function parseBudgetBody(
  body: unknown,
): { ok: true; value: ParsedBudget } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Body must be a JSON object." };
  }
  const fields = body as Record<string, unknown>;

  const agentIdInput = typeof fields.agentId === "string" ? fields.agentId.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentIdInput)) {
    return { ok: false, error: "agentId must be a UUID." };
  }
  // Canonicalize to lowercase. DSQL stores UUIDs lowercase and the deterministic budget id hashes
  // the string as given, so an uppercase id would hash to a different primary key, slip past the
  // upsert, and leave two budgets for one agent. Lowercasing keeps the id one-to-one per agent.
  const agentId = agentIdInput.toLowerCase();

  const period = typeof fields.period === "string" ? fields.period.trim() : "";
  if (!/^\d{4}-\d{2}$/.test(period)) {
    return { ok: false, error: "period must look like 2026-06." };
  }

  let category: string | null = null;
  if (typeof fields.category === "string") {
    category = fields.category.trim() === "" ? null : fields.category.trim();
  } else if (fields.category !== null && fields.category !== undefined) {
    return { ok: false, error: "category must be a string or null." };
  }

  const limit = typeof fields.limitCents === "string" ? fields.limitCents.trim() : "";
  if (!/^\d+$/.test(limit)) {
    return { ok: false, error: "limitCents must be a non-negative integer string of cents." };
  }

  return { ok: true, value: { agentId, period, category, limitCents: BigInt(limit) } };
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  const parsed = parseBudgetBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const budget = await setBudget(parsed.value);
    return NextResponse.json(toJsonSafe({ budget }));
  } catch (err) {
    console.error("POST /api/budgets failed", err);
    return NextResponse.json({ error: "Could not save the budget." }, { status: 500 });
  }
}
