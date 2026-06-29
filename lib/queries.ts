import { getPool } from "./db";

// Read side of the dashboard. Money stays as decimal cent strings the whole way, since BIGINT
// reads back from pg as a string and the API never turns it into a float. Timestamps come back
// as Date and the serialization boundary turns them into ISO strings.

// The demo scenarios create throwaway agents under this name prefix. They are test fixtures, so
// the management views (live spend, budget config) exclude them and show only the agents a finance
// team actually manages. The audit feed and the integrity counters still cover everything.
const DEMO_AGENT_PREFIX = "demo: %";

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
      WHERE a.name NOT LIKE $2
      ORDER BY a.name ASC`,
    [period, DEMO_AGENT_PREFIX],
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

export type SpendTotals = {
  totalLimitCents: string;
  totalSpentCents: string;
  totalRemainingCents: string;
  budgetCount: number;
};

// Roll the per-agent budgets up to one set of headline totals without double counting. An overall
// cap and its category budgets overlap, because a purchase decrements both, so a flat sum over all
// rows would count the same money twice. For each agent the overall cap already contains every
// category, so when one exists it is the agent's true ceiling and the categories are folded into
// it. Only an agent with no overall cap sums its category rows, which never overlap. Computed from
// the same rows the cards show, so the headline and the breakdown can never disagree.
export function aggregateSpend(agents: AgentSpend[]): SpendTotals {
  let limit = 0n;
  let remaining = 0n;
  let budgetCount = 0;
  for (const agent of agents) {
    budgetCount += agent.budgets.length;
    const cap = agent.budgets.find((b) => b.category === null);
    const counted = cap ? [cap] : agent.budgets;
    for (const budget of counted) {
      limit += BigInt(budget.limitCents);
      remaining += BigInt(budget.remainingCents);
    }
  }
  return {
    totalLimitCents: limit.toString(),
    totalRemainingCents: remaining.toString(),
    totalSpentCents: (limit - remaining).toString(),
    budgetCount,
  };
}

export type IntegrityStats = {
  overspentBudgets: number; // the live invariant: a budget whose remaining went below zero, always 0
  decisions: { approved: number; blocked: number; total: number };
};

// The proof counters behind the hero. overspentBudgets is the count of managed budgets that ever
// went negative, which is the visible no-overspend guarantee. The decision counts come from every
// recorded transaction, approved and blocked, so they read as a running total of all enforcement.
export async function integrityStats(period: string): Promise<IntegrityStats> {
  const overspent = await getPool().query<{ overspent: string }>(
    `SELECT COUNT(*) FILTER (WHERE b.remaining_cents < 0) AS overspent
       FROM budgets b
       JOIN agents a ON a.id = b.agent_id
      WHERE b.period = $1 AND a.name NOT LIKE $2`,
    [period, DEMO_AGENT_PREFIX],
  );
  const decisions = await getPool().query<{ status: string; c: string }>(
    "SELECT status, COUNT(*) AS c FROM transactions GROUP BY status",
  );

  let approved = 0;
  let blocked = 0;
  for (const d of decisions.rows) {
    if (d.status === "approved") approved = Number(d.c);
    if (d.status === "blocked") blocked = Number(d.c);
  }
  return {
    overspentBudgets: Number(overspent.rows[0]?.overspent ?? "0"),
    decisions: { approved, blocked, total: approved + blocked },
  };
}

export type AgentRow = { id: string; name: string; status: string };

export async function listAgents(): Promise<AgentRow[]> {
  const { rows } = await getPool().query<AgentRow>(
    "SELECT id, name, status FROM agents WHERE name NOT LIKE $1 ORDER BY name ASC",
    [DEMO_AGENT_PREFIX],
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
