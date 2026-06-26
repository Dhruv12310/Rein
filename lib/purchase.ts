import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "./db";
import {
  verifyMandateChain,
  type KeyResolver,
  type MandateBundle,
  type VerifyResult,
} from "./mandates";
import { withOccRetry, type RetryOptions } from "./occ";

export type PurchaseRequest = {
  agentId: string;
  amountCents: bigint; // integer cents, never a float
  category: string;
  vendor: string;
  period?: string; // defaults to the current month, the way budgets store it
  mandates: MandateBundle; // the signed Intent, Cart, Payment chain authorizing this purchase
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
  // How the verifier looks up signer public keys. Required for a real purchase; if it is absent
  // every signer is unknown and the mandate gate fails closed.
  resolveKey?: KeyResolver;
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

  // Mandate verification is pure crypto and deterministic. I fix `now` once so the expiry
  // decision is stable across retries, and run the gate inside each transaction attempt. A
  // mandate failure returns a blocked result, never a 40001, so it cannot drive the OCC retry.
  const now = new Date();
  const resolveKey = options.resolveKey ?? (() => undefined);
  const verify = (): VerifyResult =>
    verifyMandateChain(
      req.mandates,
      {
        amountCents: req.amountCents,
        category: req.category,
        vendor: req.vendor,
        agentId: req.agentId,
        now,
      },
      resolveKey,
    );

  // The retry helper runs the whole transaction again on a 40001, so retries always decide
  // against a freshly read balance. retries is surfaced so callers and tests can see contention.
  const { result, retries } = await withOccRetry(
    () => runPurchaseTxn(req, period, verify, options.afterRead),
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
  verify: () => VerifyResult,
  afterRead?: () => Promise<void>,
): Promise<PurchaseOutcome> {
  const client = await getPool().connect();
  let destroyOnRelease = false;
  try {
    await client.query("BEGIN");

    // Verify the mandate chain before any read or write. A failure is a deterministic rejection,
    // so record it as a blocked attempt with its specific reason and commit. This never retries.
    const verification = verify();
    if (!verification.ok) {
      const transactionId = await insertBlockedTransaction(client, req, verification.reason);
      await client.query("COMMIT");
      return { status: "blocked", transactionId, reason: verification.reason };
    }

    const budgets = await readApplicableBudgets(client, req, period);

    // No budget applies, or the amount does not fit one of them. Record a blocked attempt for
    // the audit trail, write no ledger entries, and commit. Recording blocks is required.
    const rejection = rejectionReason(budgets, req.amountCents);
    if (rejection) {
      const transactionId = await insertBlockedTransaction(client, req, rejection);
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
    // Persist the verified chain atomically with the money movement, so an approved transaction
    // always has a queryable Intent to Cart to Payment record, and the transaction points at the
    // payment mandate it was authorized by.
    const { paymentMandateId } = await persistMandateChain(
      client,
      req.mandates,
      verification,
      req.agentId,
    );
    const transactionId = await insertApprovedTransaction(client, req, paymentMandateId);
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

async function insertApprovedTransaction(
  client: PoolClient,
  req: PurchaseRequest,
  paymentMandateId: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO transactions (payment_mandate_id, amount_cents, category, vendor, status, reason)
     VALUES ($1, $2, $3, $4, 'approved', NULL)
     RETURNING id`,
    [paymentMandateId, req.amountCents.toString(), req.category, req.vendor],
  );
  return rows[0].id;
}

async function insertBlockedTransaction(
  client: PoolClient,
  req: PurchaseRequest,
  reason: string,
): Promise<string> {
  // A blocked attempt persists no mandate chain, so payment_mandate_id is a generated
  // placeholder. The reason records which gate, mandate or budget, stopped the purchase.
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO transactions (payment_mandate_id, amount_cents, category, vendor, status, reason)
     VALUES (gen_random_uuid(), $1, $2, $3, 'blocked', $4)
     RETURNING id`,
    [req.amountCents.toString(), req.category, req.vendor, reason],
  );
  return rows[0].id;
}

// Insert the three mandate rows linked payment to cart to intent, storing each content hash,
// signature, and the content as scope JSON. I generate the ids here so all three rows and their
// parent links go in one round trip instead of three RETURNING calls. DSQL has no foreign keys,
// so a row may reference a sibling id created in the same statement.
async function persistMandateChain(
  client: PoolClient,
  bundle: MandateBundle,
  hashes: { intentHash: string; cartHash: string; paymentHash: string },
  agentId: string,
): Promise<{ paymentMandateId: string }> {
  const intentId = randomUUID();
  const cartId = randomUUID();
  const paymentId = randomUUID();
  await client.query(
    `INSERT INTO mandates (id, agent_id, type, parent_mandate_id, scope, content_hash, signature, status)
     VALUES ($1,  $2, 'intent',  NULL, $3::jsonb,  $4,  $5,  'verified'),
            ($6,  $2, 'cart',     $1,   $7::jsonb,  $8,  $9,  'verified'),
            ($10, $2, 'payment',  $6,   $11::jsonb, $12, $13, 'verified')`,
    [
      intentId,
      agentId,
      JSON.stringify(bundle.intent.content),
      hashes.intentHash,
      bundle.intent.signature,
      cartId,
      JSON.stringify(bundle.cart.content),
      hashes.cartHash,
      bundle.cart.signature,
      paymentId,
      JSON.stringify(bundle.payment.content),
      hashes.paymentHash,
      bundle.payment.signature,
    ],
  );
  return { paymentMandateId: paymentId };
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
