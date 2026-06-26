import { type KeyObject, randomUUID } from "node:crypto";
import { getPool } from "./db";
import type { KeyResolver, MandateBundle } from "./mandates";
import { currentPeriod, type PurchaseDecision, purchase } from "./purchase";
import { buildMandateChain, generateKeyPair } from "./signing";

// The demo agent drives each scenario through the real purchase path. It never bypasses mandate
// verification or the ledger. Demo data is namespaced by an agent name prefix so it stays isolated
// and the reset can clear exactly the demo rows. Private keys are created and used here on the
// server only; nothing in lib/signing ever reaches the client.

const DEMO_PREFIX = "demo: ";

export const DEMO_SCENARIOS = [
  "approved",
  "wrong-category",
  "over-budget",
  "race",
  "replay",
  "tampered",
] as const;
export type DemoScenario = (typeof DEMO_SCENARIOS)[number];

export function isDemoScenario(value: unknown): value is DemoScenario {
  return typeof value === "string" && (DEMO_SCENARIOS as readonly string[]).includes(value);
}

export type DemoRaceResult = {
  approvedCount: number;
  blockedCount: number;
  limitCents: string;
  amountCents: string;
  finalRemainingCents: string;
  loserRetries: number;
  conflictObserved: boolean;
  booksBalanced: boolean;
};

export type DemoRunResult = {
  scenario: DemoScenario;
  title: string;
  status: "approved" | "blocked";
  summary: string;
  machineReason: string | null;
  transactionId: string | null;
  spendBeforeCents: string | null;
  spendAfterCents: string | null;
  race: DemoRaceResult | null;
};

type DemoActors = {
  principalId: string;
  vendorId: string;
  agentId: string;
  principalKey: KeyObject;
  vendorKey: KeyObject;
  agentKey: KeyObject;
  resolveKey: KeyResolver;
};

type Buy = { amountCents: bigint; category: string; vendor: string };
type Scope = {
  maxAmountCents?: bigint;
  allowedCategories?: string[];
  vendorAllowlist?: string[];
  notAfter?: Date;
};

async function createDemoAgent(label: string): Promise<DemoActors> {
  const { rows } = await getPool().query<{ id: string }>(
    "INSERT INTO agents (name, status) VALUES ($1, 'active') RETURNING id",
    [`${DEMO_PREFIX}${label}`],
  );
  const agentId = rows[0].id;
  const principal = generateKeyPair();
  const vendor = generateKeyPair();
  const agent = generateKeyPair();
  const principalId = `principal-${randomUUID()}`;
  const vendorId = `vendor-${randomUUID()}`;
  const keys = new Map<string, KeyObject>([
    [principalId, principal.publicKey],
    [vendorId, vendor.publicKey],
    [agentId, agent.publicKey],
  ]);
  return {
    principalId,
    vendorId,
    agentId,
    principalKey: principal.privateKey,
    vendorKey: vendor.privateKey,
    agentKey: agent.privateKey,
    resolveKey: (id) => keys.get(id),
  };
}

// Seed a budget with an explicit remaining, so a scenario can start from exactly the state it
// needs, for example a category that is already short on room.
async function seedDemoBudget(
  agentId: string,
  period: string,
  category: string | null,
  limitCents: bigint,
  remainingCents: bigint,
): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO budgets (agent_id, period, category, limit_cents, remaining_cents)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [agentId, period, category, limitCents.toString(), remainingCents.toString()],
  );
  return rows[0].id;
}

function demoBundle(actors: DemoActors, buy: Buy, scope: Scope = {}): MandateBundle {
  return buildMandateChain({
    principalKey: actors.principalKey,
    vendorKey: actors.vendorKey,
    agentKey: actors.agentKey,
    principalId: actors.principalId,
    vendorId: actors.vendorId,
    agentId: actors.agentId,
    amountCents: buy.amountCents,
    category: buy.category,
    vendor: buy.vendor,
    item: `${buy.category} from ${buy.vendor}`,
    maxAmountCents: scope.maxAmountCents ?? buy.amountCents * 10n,
    allowedCategories: scope.allowedCategories ?? [buy.category],
    vendorAllowlist: scope.vendorAllowlist ?? [buy.vendor],
    notAfter: scope.notAfter ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    nonce: randomUUID(),
  });
}

async function recordDemoTransaction(transactionId: string): Promise<void> {
  await getPool().query(
    "INSERT INTO demo_transactions (transaction_id) VALUES ($1) ON CONFLICT (transaction_id) DO NOTHING",
    [transactionId],
  );
}

async function runDemoPurchase(
  actors: DemoActors,
  buy: Buy,
  bundle: MandateBundle,
  afterRead?: () => Promise<void>,
): Promise<PurchaseDecision> {
  const decision = await purchase(
    {
      agentId: actors.agentId,
      amountCents: buy.amountCents,
      category: buy.category,
      vendor: buy.vendor,
      mandates: bundle,
    },
    afterRead ? { resolveKey: actors.resolveKey, afterRead } : { resolveKey: actors.resolveKey },
  );
  await recordDemoTransaction(decision.transactionId);
  return decision;
}

async function budgetSpent(budgetId: string): Promise<{ limit: bigint; remaining: bigint; spent: bigint }> {
  const { rows } = await getPool().query<{ limit_cents: string; remaining_cents: string }>(
    "SELECT limit_cents, remaining_cents FROM budgets WHERE id = $1",
    [budgetId],
  );
  const limit = BigInt(rows[0].limit_cents);
  const remaining = BigInt(rows[0].remaining_cents);
  return { limit, remaining, spent: limit - remaining };
}

async function ledgerBalanced(transactionIds: string[]): Promise<boolean> {
  const ids = transactionIds.filter(Boolean);
  if (ids.length === 0) {
    return true;
  }
  const { rows } = await getPool().query<{ direction: string; amount_cents: string }>(
    "SELECT direction, amount_cents FROM ledger_entries WHERE transaction_id = ANY($1::uuid[])",
    [ids],
  );
  let debit = 0n;
  let credit = 0n;
  for (const row of rows) {
    if (row.direction === "debit") {
      debit += BigInt(row.amount_cents);
    } else {
      credit += BigInt(row.amount_cents);
    }
  }
  return debit === credit;
}

// A small N-party rendezvous, the same idea the race test uses: every racer waits here until all
// have arrived, then they proceed together. It is how the race scenario lines both purchases up at
// the write so the optimistic-concurrency conflict happens every run, not just on lucky timing.
function makeBarrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  return async () => {
    arrived += 1;
    if (arrived >= parties) {
      release();
    }
    await gate;
  };
}

async function scenarioApproved(): Promise<DemoRunResult> {
  const period = currentPeriod();
  const actors = await createDemoAgent("Approved run");
  const budgetId = await seedDemoBudget(actors.agentId, period, "cloud", 200_000n, 200_000n);
  const buy: Buy = { amountCents: 45_000n, category: "cloud", vendor: "Acme Cloud" };
  const before = await budgetSpent(budgetId);
  const decision = await runDemoPurchase(actors, buy, demoBundle(actors, buy));
  const after = await budgetSpent(budgetId);
  return {
    scenario: "approved",
    title: "Approved purchase",
    status: decision.status,
    summary:
      "A valid, in-budget purchase was approved. The budget moved by the amount, a signed receipt was kept, and two balanced ledger rows were written.",
    machineReason: decision.status === "blocked" ? decision.reason : null,
    transactionId: decision.transactionId,
    spendBeforeCents: before.spent.toString(),
    spendAfterCents: after.spent.toString(),
    race: null,
  };
}

async function scenarioWrongCategory(): Promise<DemoRunResult> {
  const period = currentPeriod();
  const actors = await createDemoAgent("Wrong-category run");
  // The saas category is nearly spent while cloud is wide open, so a saas purchase is blocked on
  // its own category even though the agent has room elsewhere.
  const saasBudget = await seedDemoBudget(actors.agentId, period, "saas", 50_000n, 10_000n);
  await seedDemoBudget(actors.agentId, period, "cloud", 200_000n, 200_000n);
  const buy: Buy = { amountCents: 30_000n, category: "saas", vendor: "Initech" };
  const before = await budgetSpent(saasBudget);
  const decision = await runDemoPurchase(actors, buy, demoBundle(actors, buy));
  const after = await budgetSpent(saasBudget);
  return {
    scenario: "wrong-category",
    title: "Wrong-category block",
    status: decision.status,
    summary:
      "The saas budget had no room left, so a saas purchase was blocked on that category, even though the cloud budget was untouched. Spend is controlled per category, not just overall.",
    machineReason: decision.status === "blocked" ? decision.reason : null,
    transactionId: decision.transactionId,
    spendBeforeCents: before.spent.toString(),
    spendAfterCents: after.spent.toString(),
    race: null,
  };
}

async function scenarioOverBudget(): Promise<DemoRunResult> {
  const period = currentPeriod();
  const actors = await createDemoAgent("Over-budget run");
  const budgetId = await seedDemoBudget(actors.agentId, period, null, 50_000n, 50_000n);
  const buy: Buy = { amountCents: 90_000n, category: "data", vendor: "Northwind Data" };
  const before = await budgetSpent(budgetId);
  const decision = await runDemoPurchase(actors, buy, demoBundle(actors, buy));
  const after = await budgetSpent(budgetId);
  return {
    scenario: "over-budget",
    title: "Over-budget block",
    status: decision.status,
    summary:
      "The purchase was larger than the budget had remaining, so it was blocked before any money moved and the budget stayed where it was.",
    machineReason: decision.status === "blocked" ? decision.reason : null,
    transactionId: decision.transactionId,
    spendBeforeCents: before.spent.toString(),
    spendAfterCents: after.spent.toString(),
    race: null,
  };
}

async function scenarioRace(): Promise<DemoRunResult> {
  const period = currentPeriod();
  const actors = await createDemoAgent("Race run");
  const amount = 60_000n;
  // The overall cap fits either purchase alone but not both together.
  const budgetId = await seedDemoBudget(actors.agentId, period, null, 100_000n, 100_000n);
  const buyA: Buy = { amountCents: amount, category: "cloud", vendor: "Acme Cloud" };
  const buyB: Buy = { amountCents: amount, category: "cloud", vendor: "Globex Compute" };
  const bundleA = demoBundle(actors, buyA);
  const bundleB = demoBundle(actors, buyB);

  // Hold both transactions at the write so they collide at commit every run.
  const barrier = makeBarrier(2);
  const [a, b] = await Promise.all([
    runDemoPurchase(actors, buyA, bundleA, barrier),
    runDemoPurchase(actors, buyB, bundleB, barrier),
  ]);

  const approved = [a, b].filter((decision) => decision.status === "approved");
  const blocked = [a, b].filter((decision) => decision.status === "blocked");
  const loser = blocked[0];
  const loserRetries = loser ? loser.retries : 0;
  const after = await budgetSpent(budgetId);
  const balanced = await ledgerBalanced([a.transactionId, b.transactionId]);

  return {
    scenario: "race",
    title: "Concurrent race",
    status: "approved",
    summary:
      "Two purchases raced for the same budget. DSQL let one commit and rejected the other at commit time as a write-write conflict, so the budget moved exactly once and the books stayed balanced.",
    machineReason: loser && loser.status === "blocked" ? loser.reason : null,
    transactionId: approved[0]?.transactionId ?? null,
    spendBeforeCents: "0",
    spendAfterCents: after.spent.toString(),
    race: {
      approvedCount: approved.length,
      blockedCount: blocked.length,
      limitCents: "100000",
      amountCents: amount.toString(),
      finalRemainingCents: after.remaining.toString(),
      loserRetries,
      conflictObserved: loserRetries > 0,
      booksBalanced: balanced,
    },
  };
}

async function scenarioReplay(): Promise<DemoRunResult> {
  const period = currentPeriod();
  const actors = await createDemoAgent("Replay run");
  const budgetId = await seedDemoBudget(actors.agentId, period, null, 200_000n, 200_000n);
  const buy: Buy = { amountCents: 40_000n, category: "data", vendor: "Northwind Data" };
  const bundle = demoBundle(actors, buy);

  await runDemoPurchase(actors, buy, bundle); // first, approved
  const before = await budgetSpent(budgetId);
  const second = await runDemoPurchase(actors, buy, bundle); // the identical signed bundle again
  const after = await budgetSpent(budgetId);

  return {
    scenario: "replay",
    title: "Replay block",
    status: second.status,
    summary:
      "The same signed payment was submitted twice. The first was approved; the second was blocked, because a payment authorizes at most one charge, so the budget moved only once.",
    machineReason: second.status === "blocked" ? second.reason : null,
    transactionId: second.transactionId,
    spendBeforeCents: before.spent.toString(),
    spendAfterCents: after.spent.toString(),
    race: null,
  };
}

async function scenarioTampered(): Promise<DemoRunResult> {
  const period = currentPeriod();
  const actors = await createDemoAgent("Tampered run");
  const budgetId = await seedDemoBudget(actors.agentId, period, null, 200_000n, 200_000n);
  const buy: Buy = { amountCents: 25_000n, category: "saas", vendor: "Initech" };
  const bundle = demoBundle(actors, buy);
  // Change a signed field after signing, so the signature no longer matches the content.
  bundle.intent.content.nonce = `tampered-${randomUUID()}`;
  const before = await budgetSpent(budgetId);
  const decision = await runDemoPurchase(actors, buy, bundle);
  const after = await budgetSpent(budgetId);

  return {
    scenario: "tampered",
    title: "Tampered mandate block",
    status: decision.status,
    summary:
      "A signed mandate field was changed after signing. Verification failed on the signature, so the purchase was blocked before any money moved.",
    machineReason: decision.status === "blocked" ? decision.reason : null,
    transactionId: decision.transactionId,
    spendBeforeCents: before.spent.toString(),
    spendAfterCents: after.spent.toString(),
    race: null,
  };
}

export async function runDemoScenario(scenario: DemoScenario): Promise<DemoRunResult> {
  switch (scenario) {
    case "approved":
      return scenarioApproved();
    case "wrong-category":
      return scenarioWrongCategory();
    case "over-budget":
      return scenarioOverBudget();
    case "race":
      return scenarioRace();
    case "replay":
      return scenarioReplay();
    case "tampered":
      return scenarioTampered();
  }
}

// Clear only demo-scoped rows. Demo agents are found by the name prefix, and demo transactions,
// including the blocked ones that link to no mandate, are found through demo_transactions. Nothing
// keyed off non-demo agents or transactions is touched.
export async function resetDemo(): Promise<{ agents: number; transactions: number }> {
  const pool = getPool();
  const { rows: agentRows } = await pool.query<{ id: string }>(
    "SELECT id FROM agents WHERE name LIKE $1",
    [`${DEMO_PREFIX}%`],
  );
  const agentIds = agentRows.map((row) => row.id);
  const { rows: txnRows } = await pool.query<{ transaction_id: string }>(
    "SELECT transaction_id FROM demo_transactions",
  );
  const transactionIds = txnRows.map((row) => row.transaction_id);

  if (transactionIds.length > 0) {
    await pool.query("DELETE FROM redeemed_payments WHERE transaction_id = ANY($1::uuid[])", [
      transactionIds,
    ]);
    await pool.query("DELETE FROM ledger_entries WHERE transaction_id = ANY($1::uuid[])", [
      transactionIds,
    ]);
    await pool.query("DELETE FROM transactions WHERE id = ANY($1::uuid[])", [transactionIds]);
    await pool.query("DELETE FROM demo_transactions WHERE transaction_id = ANY($1::uuid[])", [
      transactionIds,
    ]);
  }
  if (agentIds.length > 0) {
    await pool.query("DELETE FROM mandates WHERE agent_id = ANY($1::uuid[])", [agentIds]);
    await pool.query("DELETE FROM budgets WHERE agent_id = ANY($1::uuid[])", [agentIds]);
    await pool.query("DELETE FROM agents WHERE id = ANY($1::uuid[])", [agentIds]);
  }

  return { agents: agentIds.length, transactions: transactionIds.length };
}
