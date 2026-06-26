import { type KeyObject, randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { setBudget } from "../lib/budgets";
import { closePool, getPool } from "../lib/db";
import type { KeyResolver, MandateBundle } from "../lib/mandates";
import { currentPeriod, purchase } from "../lib/purchase";
import { buildMandateChain, generateKeyPair } from "../lib/signing";

// Minimal seed: a handful of agents, some budgets, and a run of real purchases through the real
// path so the dashboard has honest data to build and review against. A few approvals across
// categories and one block of each kind, so the feed shows every gate. The polished demo
// scenarios come later. Vendor names are fictional to keep the data free of real brands.
loadEnvConfig(process.cwd());

const TABLES = ["redeemed_payments", "ledger_entries", "mandates", "transactions", "budgets", "agents"];

// Clear prior demo data so a re-run gives a clean, consistent slate. The seed keeps every table
// small, so this stays well under DSQL's per-transaction row limit.
async function reset(): Promise<void> {
  const pool = getPool();
  for (const table of TABLES) {
    await pool.query(`DELETE FROM ${table}`);
  }
}

async function createAgent(name: string): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    "INSERT INTO agents (name, status) VALUES ($1, 'active') RETURNING id",
    [name],
  );
  return rows[0].id;
}

type Actors = {
  principalId: string;
  vendorId: string;
  agentId: string;
  principalKey: KeyObject;
  vendorKey: KeyObject;
  agentKey: KeyObject;
  resolveKey: KeyResolver;
};

function makeActors(agentId: string): Actors {
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

type Buy = { amountCents: bigint; category: string; vendor: string };

type Scope = {
  maxAmountCents?: bigint;
  allowedCategories?: string[];
  vendorAllowlist?: string[];
  notAfter?: Date;
};

function bundleFor(actors: Actors, buy: Buy, scope: Scope = {}): MandateBundle {
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
    // Generous authorization by default, so the budget gate, not the cap, decides an approval.
    maxAmountCents: scope.maxAmountCents ?? buy.amountCents * 10n,
    allowedCategories: scope.allowedCategories ?? [buy.category],
    vendorAllowlist: scope.vendorAllowlist ?? [buy.vendor],
    notAfter: scope.notAfter ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    nonce: randomUUID(),
  });
}

async function run(actors: Actors, buy: Buy, bundle: MandateBundle): Promise<void> {
  const decision = await purchase(
    {
      agentId: actors.agentId,
      amountCents: buy.amountCents,
      category: buy.category,
      vendor: buy.vendor,
      mandates: bundle,
    },
    { resolveKey: actors.resolveKey },
  );
  const dollars = (Number(buy.amountCents) / 100).toFixed(2);
  const note = decision.status === "blocked" ? decision.reason : "";
  console.log(
    `  ${decision.status.padEnd(8)} ${buy.category.padEnd(7)} ${buy.vendor.padEnd(20)} $${dollars.padStart(8)}  ${note}`,
  );
}

async function main(): Promise<void> {
  console.log("Resetting demo data ...");
  await reset();
  const period = currentPeriod();

  const procurementId = await createAgent("Procurement Bot");
  const analyticsId = await createAgent("Analytics Agent");
  const researchId = await createAgent("Research Assistant");
  const procurement = makeActors(procurementId);
  const analytics = makeActors(analyticsId);
  const research = makeActors(researchId);

  console.log("Setting budgets ...");
  await setBudget({ agentId: procurementId, period, category: null, limitCents: 500_000n });
  await setBudget({ agentId: procurementId, period, category: "cloud", limitCents: 250_000n });
  await setBudget({ agentId: procurementId, period, category: "saas", limitCents: 150_000n });
  await setBudget({ agentId: analyticsId, period, category: null, limitCents: 300_000n });
  await setBudget({ agentId: analyticsId, period, category: "data", limitCents: 200_000n });
  await setBudget({ agentId: researchId, period, category: "saas", limitCents: 80_000n });

  console.log("Running purchases ...");
  // Approved, across agents and categories.
  await run(procurement, { amountCents: 62_000n, category: "cloud", vendor: "Acme Cloud" }, bundleFor(procurement, { amountCents: 62_000n, category: "cloud", vendor: "Acme Cloud" }));
  await run(procurement, { amountCents: 41_000n, category: "cloud", vendor: "Globex Compute" }, bundleFor(procurement, { amountCents: 41_000n, category: "cloud", vendor: "Globex Compute" }));
  await run(procurement, { amountCents: 29_000n, category: "saas", vendor: "Initech" }, bundleFor(procurement, { amountCents: 29_000n, category: "saas", vendor: "Initech" }));
  await run(analytics, { amountCents: 75_000n, category: "data", vendor: "Northwind Data" }, bundleFor(analytics, { amountCents: 75_000n, category: "data", vendor: "Northwind Data" }));
  await run(analytics, { amountCents: 48_000n, category: "data", vendor: "Umbrella Analytics" }, bundleFor(analytics, { amountCents: 48_000n, category: "data", vendor: "Umbrella Analytics" }));
  await run(research, { amountCents: 12_000n, category: "saas", vendor: "Contoso" }, bundleFor(research, { amountCents: 12_000n, category: "saas", vendor: "Contoso" }));

  // Blocked, one of each gate, so the feed shows every reason.
  // Over budget: the research saas budget has little room left after the approval above.
  await run(research, { amountCents: 90_000n, category: "saas", vendor: "Contoso" }, bundleFor(research, { amountCents: 90_000n, category: "saas", vendor: "Contoso" }));
  // Expired authorization.
  await run(procurement, { amountCents: 30_000n, category: "cloud", vendor: "Acme Cloud" }, bundleFor(procurement, { amountCents: 30_000n, category: "cloud", vendor: "Acme Cloud" }, { notAfter: new Date(Date.now() - 60_000) }));
  // Category outside the authorization.
  await run(procurement, { amountCents: 20_000n, category: "data", vendor: "Northwind Data" }, bundleFor(procurement, { amountCents: 20_000n, category: "data", vendor: "Northwind Data" }, { allowedCategories: ["cloud"] }));
  // Vendor outside the authorization.
  await run(analytics, { amountCents: 30_000n, category: "data", vendor: "Stark Industries" }, bundleFor(analytics, { amountCents: 30_000n, category: "data", vendor: "Stark Industries" }, { vendorAllowlist: ["Northwind Data"] }));
  // Tampered intent: the signature no longer matches.
  const tampered = bundleFor(procurement, { amountCents: 10_000n, category: "saas", vendor: "Initech" });
  tampered.intent.content.nonce = `tampered-${randomUUID()}`;
  await run(procurement, { amountCents: 10_000n, category: "saas", vendor: "Initech" }, tampered);
  // Replay: the same valid payment submitted twice, the second is already charged.
  const replayBuy = { amountCents: 22_000n, category: "data", vendor: "Northwind Data" };
  const replayBundle = bundleFor(analytics, replayBuy);
  await run(analytics, replayBuy, replayBundle);
  await run(analytics, replayBuy, replayBundle);

  console.log("Seed complete.");
}

main()
  .catch((err) => {
    console.error("Seed failed.");
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closePool);
