import { randomUUID } from "node:crypto";
import { getPool } from "../lib/db";

// Integration tests share one live cluster, so each test seeds its own agent and budgets with
// unique ids and deletes exactly what it created. These helpers keep that bookkeeping in one
// place so the test bodies stay about behavior, not SQL.

export async function createAgent(): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    "INSERT INTO agents (name, status) VALUES ($1, 'active') RETURNING id",
    [`test-agent-${randomUUID()}`],
  );
  return rows[0].id;
}

export async function createBudget(params: {
  agentId: string;
  period: string;
  category: string | null;
  limitCents: bigint;
  remainingCents?: bigint; // defaults to limitCents, a fresh budget
}): Promise<string> {
  const remaining = params.remainingCents ?? params.limitCents;
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO budgets (agent_id, period, category, limit_cents, remaining_cents)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      params.agentId,
      params.period,
      params.category,
      params.limitCents.toString(),
      remaining.toString(),
    ],
  );
  return rows[0].id;
}

// Read as a string and convert to BigInt so cents stay exact.
export async function remainingCents(budgetId: string): Promise<bigint> {
  const { rows } = await getPool().query<{ remaining_cents: string }>(
    "SELECT remaining_cents FROM budgets WHERE id = $1",
    [budgetId],
  );
  return BigInt(rows[0].remaining_cents);
}

export type LedgerEntry = { account: string; direction: string; amount_cents: string };

export async function ledgerEntriesFor(transactionIds: string[]): Promise<LedgerEntry[]> {
  if (transactionIds.length === 0) {
    return [];
  }
  const { rows } = await getPool().query<LedgerEntry>(
    `SELECT account, direction, amount_cents
       FROM ledger_entries
      WHERE transaction_id = ANY($1::uuid[])`,
    [transactionIds],
  );
  return rows;
}

export async function transactionRow(
  transactionId: string,
): Promise<{ status: string; reason: string | null; amount_cents: string } | undefined> {
  const { rows } = await getPool().query<{
    status: string;
    reason: string | null;
    amount_cents: string;
  }>("SELECT status, reason, amount_cents FROM transactions WHERE id = $1", [transactionId]);
  return rows[0];
}

export function sumCents(entries: LedgerEntry[]): bigint {
  return entries.reduce((total, entry) => total + BigInt(entry.amount_cents), 0n);
}

// Delete child rows before parents. DSQL has no foreign keys, so order is for clarity, not a
// constraint. Transactions carry no agent_id, so the test passes the ids it collected.
export async function cleanup(params: {
  agentId: string;
  budgetIds: string[];
  transactionIds: string[];
}): Promise<void> {
  const pool = getPool();
  if (params.transactionIds.length > 0) {
    await pool.query("DELETE FROM ledger_entries WHERE transaction_id = ANY($1::uuid[])", [
      params.transactionIds,
    ]);
    await pool.query("DELETE FROM transactions WHERE id = ANY($1::uuid[])", [
      params.transactionIds,
    ]);
  }
  if (params.budgetIds.length > 0) {
    await pool.query("DELETE FROM budgets WHERE id = ANY($1::uuid[])", [params.budgetIds]);
  }
  // Mandates carry agent_id, so the test's whole chain clears by agent in one statement.
  await pool.query("DELETE FROM mandates WHERE agent_id = $1", [params.agentId]);
  await pool.query("DELETE FROM agents WHERE id = $1", [params.agentId]);
}

export type MandateChainRow = {
  id: string;
  type: string;
  parent_mandate_id: string | null;
  content_hash: string;
  signature: string;
  scope: unknown;
};

async function fetchMandate(id: string): Promise<MandateChainRow | undefined> {
  const { rows } = await getPool().query<MandateChainRow>(
    "SELECT id, type, parent_mandate_id, content_hash, signature, scope FROM mandates WHERE id = $1",
    [id],
  );
  return rows[0];
}

// Walk the persisted chain for an approved transaction: payment, then its parent cart, then the
// intent, following parent_mandate_id. Proves the chain is queryable end to end.
export async function loadMandateChainForTransaction(transactionId: string): Promise<{
  payment?: MandateChainRow;
  cart?: MandateChainRow;
  intent?: MandateChainRow;
}> {
  const { rows } = await getPool().query<{ payment_mandate_id: string }>(
    "SELECT payment_mandate_id FROM transactions WHERE id = $1",
    [transactionId],
  );
  const paymentId = rows[0]?.payment_mandate_id;
  if (!paymentId) {
    return {};
  }
  const payment = await fetchMandate(paymentId);
  const cart = payment?.parent_mandate_id ? await fetchMandate(payment.parent_mandate_id) : undefined;
  const intent = cart?.parent_mandate_id ? await fetchMandate(cart.parent_mandate_id) : undefined;
  return { payment, cart, intent };
}

export async function countMandatesForAgent(agentId: string): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    "SELECT count(*) AS count FROM mandates WHERE agent_id = $1",
    [agentId],
  );
  return Number(rows[0].count);
}

// A simple N-party rendezvous. Every caller awaits until `parties` of them have arrived, then
// they all proceed together. The race test uses it as the afterRead seam so racing purchases
// reach the budget update at the same instant.
export function makeBarrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrived++;
    if (arrived >= parties) {
      release();
    }
    await gate;
  };
}
