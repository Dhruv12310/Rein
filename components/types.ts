// The client-facing shapes the API returns after the serialization boundary: money as decimal
// cent strings, timestamps as ISO strings.

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

export type SpendResponse = { period: string; agents: AgentSpend[] };

export type OverviewStats = {
  totalLimitCents: string;
  totalSpentCents: string;
  totalRemainingCents: string;
  budgetCount: number;
  overspentBudgets: number;
  decisions: { approved: number; blocked: number; total: number };
};

export type OverviewResponse = { period: string; stats: OverviewStats; agents: AgentSpend[] };

export type Transaction = {
  id: string;
  amountCents: string;
  category: string | null;
  vendor: string | null;
  status: string;
  reason: string | null;
  createdAt: string;
};

export type FeedResponse = { transactions: Transaction[] };

export type AgentRow = { id: string; name: string; status: string };
export type AgentsResponse = { agents: AgentRow[] };

export type MandateNode = {
  id: string;
  type: string;
  parentMandateId: string | null;
  contentHash: string;
  signature: string;
  scope: unknown;
  createdAt: string;
};

export type AuditChain = {
  transaction: Transaction;
  intent: MandateNode | null;
  cart: MandateNode | null;
  payment: MandateNode | null;
};
