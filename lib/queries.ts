import { getPool } from "./db";

// Read side of the dashboard. Money stays as decimal cent strings the whole way, since BIGINT
// reads back from pg as a string and the API never turns it into a float. Timestamps come back
// as Date and the serialization boundary turns them into ISO strings.

export type BudgetSpend = {
  id: string;
  category: string | null;
  limitCents: string;
  remainingCents: string;
  spentCents: string;
};

export type AgentSpend = {
  id: string;
  name: string;
  status: string;
  budgets: BudgetSpend[];
};

// Spend per agent and per category for one period: limit, spent, and remaining straight off the
// budget rows the purchase path decrements, so the view always agrees with the ledger. A LEFT
// JOIN keeps agents that have no budget yet so they still show up.
export async function spendSummary(period: string): Promise<AgentSpend[]> {
  const { rows } = await getPool().query<{
    agent_id: string;
    agent_name: string;
    agent_status: string;
    budget_id: string | null;
    category: string | null;
    limit_cents: string | null;
    remaining_cents: string | null;
    spent_cents: string | null;
  }>(
    `SELECT a.id AS agent_id, a.name AS agent_name, a.status AS agent_status,
            b.id AS budget_id, b.category,
            b.limit_cents, b.remaining_cents,
            (b.limit_cents - b.remaining_cents) AS spent_cents
       FROM agents a
       LEFT JOIN budgets b ON b.agent_id = a.id AND b.period = $1
      ORDER BY a.name ASC`,
    [period],
  );

  const byAgent = new Map<string, AgentSpend>();
  for (const row of rows) {
    let agent = byAgent.get(row.agent_id);
    if (!agent) {
      agent = { id: row.agent_id, name: row.agent_name, status: row.agent_status, budgets: [] };
      byAgent.set(row.agent_id, agent);
    }
    if (row.budget_id && row.limit_cents !== null && row.remaining_cents !== null) {
      agent.budgets.push({
        id: row.budget_id,
        category: row.category,
        limitCents: row.limit_cents,
        remainingCents: row.remaining_cents,
        spentCents: row.spent_cents ?? "0",
      });
    }
  }

  const agents = [...byAgent.values()];
  // Overall cap first, then categories alphabetically, so each agent reads top to bottom.
  for (const agent of agents) {
    agent.budgets.sort((a, b) => {
      if (a.category === null) return -1;
      if (b.category === null) return 1;
      return a.category.localeCompare(b.category);
    });
  }
  return agents;
}

export type AgentRow = { id: string; name: string; status: string };

export async function listAgents(): Promise<AgentRow[]> {
  const { rows } = await getPool().query<AgentRow>(
    "SELECT id, name, status FROM agents ORDER BY name ASC",
  );
  return rows;
}

export type Transaction = {
  id: string;
  amountCents: string;
  category: string | null;
  vendor: string | null;
  status: string;
  reason: string | null;
  createdAt: Date;
};

export async function transactionFeed(limit = 50): Promise<Transaction[]> {
  const { rows } = await getPool().query<{
    id: string;
    amount_cents: string;
    category: string | null;
    vendor: string | null;
    status: string;
    reason: string | null;
    created_at: Date;
  }>(
    `SELECT id, amount_cents, category, vendor, status, reason, created_at
       FROM transactions
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    id: row.id,
    amountCents: row.amount_cents,
    category: row.category,
    vendor: row.vendor,
    status: row.status,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}

export type MandateNode = {
  id: string;
  type: string;
  parentMandateId: string | null;
  contentHash: string;
  signature: string;
  scope: unknown;
  createdAt: Date;
};

export type AuditChain = {
  transaction: Transaction;
  intent: MandateNode | null;
  cart: MandateNode | null;
  payment: MandateNode | null;
} | null;

async function fetchMandate(id: string): Promise<MandateNode | null> {
  const { rows } = await getPool().query<{
    id: string;
    type: string;
    parent_mandate_id: string | null;
    content_hash: string;
    signature: string;
    scope: unknown;
    created_at: Date;
  }>(
    `SELECT id, type, parent_mandate_id, content_hash, signature, scope, created_at
       FROM mandates WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    type: row.type,
    parentMandateId: row.parent_mandate_id,
    contentHash: row.content_hash,
    signature: row.signature,
    scope: row.scope,
    createdAt: row.created_at,
  };
}

// Walk one approved transaction to its full chain by following payment_mandate_id, then the
// parent links up through cart to intent. Plain primary-key lookups, so it does not depend on a
// recursive query. A blocked transaction has no real payment mandate, so the chain is null.
export async function auditChain(transactionId: string): Promise<AuditChain> {
  const { rows } = await getPool().query<{
    id: string;
    payment_mandate_id: string;
    amount_cents: string;
    category: string | null;
    vendor: string | null;
    status: string;
    reason: string | null;
    created_at: Date;
  }>(
    `SELECT id, payment_mandate_id, amount_cents, category, vendor, status, reason, created_at
       FROM transactions WHERE id = $1`,
    [transactionId],
  );
  const txn = rows[0];
  if (!txn) {
    return null;
  }
  const payment = await fetchMandate(txn.payment_mandate_id);
  const cart = payment?.parentMandateId ? await fetchMandate(payment.parentMandateId) : null;
  const intent = cart?.parentMandateId ? await fetchMandate(cart.parentMandateId) : null;
  return {
    transaction: {
      id: txn.id,
      amountCents: txn.amount_cents,
      category: txn.category,
      vendor: txn.vendor,
      status: txn.status,
      reason: txn.reason,
      createdAt: txn.created_at,
    },
    intent,
    cart,
    payment,
  };
}
