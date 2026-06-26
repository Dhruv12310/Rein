import type { PoolClient } from "pg";
import { getPool } from "./db";
import { withOccRetry, type RetryOptions } from "./occ";

export type PurchaseRequest = {
  agentId: string;
  amountCents: bigint; // integer cents, never a float
  category: string;
  vendor: string;
  period?: string; // defaults to the current month, the way budgets store it
};

export type PurchaseDecision =
  | { status: "approved"; transactionId: string; retries: number }
  | { status: "blocked"; transactionId: string; reason: string; retries: number };

// One transaction attempt's outcome, before the retry count is attached. Kept separate from
// PurchaseDecision because Omit over a discriminated union would drop the blocked reason.
type PurchaseOutcome =
  | { status: "approved"; transactionId: string }
  | { status: "blocked"; transactionId: string; reason: string };

export type PurchaseOptions = RetryOptions & {
  // Test seam, unused in production. Invoked after the budgets are read and before the budget
  // update, so a concurrency test can hold every racing transaction at the same point and
  // release them into the write together, which forces the write-write conflict every run
  // instead of relying on timing.
  afterRead?: () => Promise<void>;
};

// The budget period as budgets store it, for example "2026-06". UTC so the boundary is the
// same everywhere the code runs.
export function currentPeriod(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

type BudgetRow = { id: string; category: string | null; remaining_cents: string };

// Phase 2 hook. The payment mandate signature and the intent to cart to payment chain get
// verified here, before any read or write, and an invalid chain rejects the purchase. Phase 1
// has no mandates yet, so this is intentionally a no-op that always passes. No signing logic
// belongs in Phase 1 (see docs/PLAN.md, Phase C).
async function verifyPaymentMandate(_req: PurchaseRequest): Promise<void> {}

export async function purchase(
  req: PurchaseRequest,
  options: PurchaseOptions = {},
): Promise<PurchaseDecision> {
  if (req.amountCents <= 0n) {
    throw new Error("amountCents must be a positive number of integer cents");
  }
  if (!req.agentId || !req.category || !req.vendor) {
    throw new Error("purchase requires agentId, category, and vendor");
  }
  const period = req.period ?? currentPeriod();

  // The retry helper runs the whole transaction again on a 40001, so retries always decide
  // against a freshly read balance. retries is surfaced so callers and tests can see contention.
  const { result, retries } = await withOccRetry(
    () => runPurchaseTxn(req, period, options.afterRead),
    options,
  );
  if (result.status === "approved") {
    return { status: "approved", transactionId: result.transactionId, retries };
  }
  return { status: "blocked", transactionId: result.transactionId, reason: result.reason, retries };
}

// One full attempt: a single dedicated client, BEGIN through COMMIT. Never split this across
// separate pool checkouts, the whole transaction lives on one connection.
async function runPurchaseTxn(
  req: PurchaseRequest,
  period: string,
  afterRead?: () => Promise<void>,
): Promise<PurchaseOutcome> {
  const client = await getPool().connect();
  let destroyOnRelease = false;
  try {
    await client.query("BEGIN");

    // Phase 2 mandate verification goes here, before any read or write.
    await verifyPaymentMandate(req);

    const budgets = await readApplicableBudgets(client, req, period);

    // No budget applies, or the amount does not fit one of them. Record a blocked attempt for
    // the audit trail, write no ledger entries, and commit. Recording blocks is required.
    const rejection = rejectionReason(budgets, req.amountCents);
    if (rejection) {
      const transactionId = await insertTransaction(client, req, "blocked", rejection);
      await client.query("COMMIT");
      return { status: "blocked", transactionId, reason: rejection };
    }

    // Test seam: line up racing transactions here, after all have read room, before any writes.
    if (afterRead) {
      await afterRead();
    }

    // Approve. The unconditional UPDATE on each applicable budget row is the conflict point:
    // two purchases racing the same budget both write this row and one loses at COMMIT with
    // 40001. No SELECT FOR UPDATE, the write itself is what conflicts.
    for (const budget of budgets) {
      await client.query(
        "UPDATE budgets SET remaining_cents = remaining_cents - $1, updated_at = now() WHERE id = $2",
        [req.amountCents.toString(), budget.id],
      );
    }
    const transactionId = await insertTransaction(client, req, "approved", null);
    await insertLedgerEntries(client, transactionId, req.amountCents);
    await client.query("COMMIT");
    return { status: "approved", transactionId };
  } catch (err) {
    // Reset the connection before the retry runs or the pool reuses it. After a failed COMMIT
    // the transaction is already aborted, so this is a no-op there; for an error raised mid
    // transaction it is a real rollback. If even the rollback fails, the connection cannot be
    // trusted, so destroy it on release rather than hand a dirty client back to the pool.
    try {
      await client.query("ROLLBACK");
    } catch {
      destroyOnRelease = true;
    }
    throw err;
  } finally {
    client.release(destroyOnRelease);
  }
}

// Budgets that apply to this purchase: same agent and period, and either the overall cap
// (category is null) or the budget for this exact category. A purchase must fit every one.
async function readApplicableBudgets(
  client: PoolClient,
  req: PurchaseRequest,
  period: string,
): Promise<BudgetRow[]> {
  const { rows } = await client.query<BudgetRow>(
    `SELECT id, category, remaining_cents
       FROM budgets
      WHERE agent_id = $1 AND period = $2 AND (category IS NULL OR category = $3)`,
    [req.agentId, period, req.category],
  );
  return rows;
}

// Returns a short reason when the purchase cannot be approved, or null when it fits everywhere.
// remaining_cents is read as a string and compared as BigInt so cents stay exact.
function rejectionReason(budgets: BudgetRow[], amountCents: bigint): string | null {
  if (budgets.length === 0) {
    return "no budget covers this agent, period, and category";
  }
  for (const budget of budgets) {
    if (amountCents > BigInt(budget.remaining_cents)) {
      const scope = budget.category === null ? "overall cap" : `category ${budget.category}`;
      return `amount exceeds remaining on ${scope}`;
    }
  }
  return null;
}

async function insertTransaction(
  client: PoolClient,
  req: PurchaseRequest,
  status: "approved" | "blocked",
  reason: string | null,
): Promise<string> {
  // Phase 1 has no mandate yet, so payment_mandate_id is a generated placeholder. Phase 2 will
  // pass the verified payment mandate's id here; the column stays NOT NULL so the shape holds.
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO transactions (payment_mandate_id, amount_cents, category, vendor, status, reason)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)
     RETURNING id`,
    [req.amountCents.toString(), req.category, req.vendor, status, reason],
  );
  return rows[0].id;
}

// Two balanced rows per approved purchase: a debit to expense and a credit to budget, both for
// the full amount, so debits equal credits for every transaction.
async function insertLedgerEntries(
  client: PoolClient,
  transactionId: string,
  amountCents: bigint,
): Promise<void> {
  await client.query(
    `INSERT INTO ledger_entries (transaction_id, account, direction, amount_cents)
     VALUES ($1, 'expense', 'debit', $2), ($1, 'budget', 'credit', $2)`,
    [transactionId, amountCents.toString()],
  );
}
