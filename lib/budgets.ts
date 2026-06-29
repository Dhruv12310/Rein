import { createHash } from "node:crypto";
import { getPool } from "./db";
import { isSerializationError } from "./occ";

// A fixed namespace for Rein budget ids. With it, the same agent, period, and category always
// hash to the same budget primary key, so a duplicate budget cannot exist: a second write lands
// on the same row. This reuses the primary-key collision guarantee the ledger already relies on.
const BUDGET_NAMESPACE = "7d3a1f6c-9b2e-4c8a-a5d7-1e0f2b3c4d5e";

// uuid v5 (sha1, name-based) with node's crypto, so no dependency is added. sha1 of the
// namespace bytes followed by the name, take the first 16 bytes, then set the version and
// variant bits per RFC 4122.
function uuidV5(name: string, namespace: string): string {
  const namespaceBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const digest = createHash("sha1").update(namespaceBytes).update(name, "utf8").digest();
  const bytes = digest.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10x
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// The name is the JSON of the identity triple, not a delimiter join: category is free text that
// could contain a separator and collide with a different triple, and JSON keeps a null overall
// cap distinct from an empty-string category. So one agent, period, and category always map to
// one id, and nothing else does.
export function budgetId(agentId: string, period: string, category: string | null): string {
  return uuidV5(JSON.stringify([agentId, period, category]), BUDGET_NAMESPACE);
}

export type BudgetRecord = {
  id: string;
  agent_id: string;
  period: string;
  category: string | null;
  limit_cents: string;
  remaining_cents: string;
};

function backoffDelay(attempt: number): number {
  const ceiling = Math.min(200, 10 * 2 ** (attempt - 1));
  return 5 + Math.random() * ceiling;
}

// Create or update a budget. The deterministic id makes this an upsert on the primary key. A new
// budget starts with its full limit remaining; re-setting an existing one shifts remaining by the
// limit delta, so already-recorded spend is preserved. Money that is already spent cannot be
// un-spent, so a limit cannot be lowered below the current spend: the new limit floors at the
// spent amount and remaining floors at zero, which keeps remaining non-negative and the identity
// spent equals limit minus remaining true. A concurrent double-set collides at COMMIT with 40001,
// which is retried, and the retry sees the committed row through ON CONFLICT, so the pair resolves
// to exactly one row.
export async function setBudget(
  params: { agentId: string; period: string; category: string | null; limitCents: bigint },
  maxAttempts = 6,
): Promise<BudgetRecord> {
  const id = budgetId(params.agentId, params.period, params.category);
  const limit = params.limitCents.toString();
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      const { rows } = await getPool().query<BudgetRecord>(
        `INSERT INTO budgets (id, agent_id, period, category, limit_cents, remaining_cents)
         VALUES ($1, $2, $3, $4, $5, $5)
         ON CONFLICT (id) DO UPDATE SET
           limit_cents = GREATEST(EXCLUDED.limit_cents, budgets.limit_cents - budgets.remaining_cents),
           remaining_cents = GREATEST(0, budgets.remaining_cents + (EXCLUDED.limit_cents - budgets.limit_cents)),
           updated_at = now()
         RETURNING id, agent_id, period, category, limit_cents, remaining_cents`,
        [id, params.agentId, params.period, params.category, limit],
      );
      return rows[0];
    } catch (err) {
      if (isSerializationError(err) && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, backoffDelay(attempt)));
        continue;
      }
      throw err;
    }
  }
}
