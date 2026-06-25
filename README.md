# Rein

A spending-control layer for AI agents.

Companies are starting to let agents buy things on their own: renew subscriptions, pay APIs for data and inference, provision cloud capacity. Today an agent runs on a shared API key or a saved card with no limit, and finance learns what it bought when the invoice arrives. Rein gives every agent a corporate card with a real limit.

What it does:

- Issues each agent a budget with limits per category and per period.
- Checks every purchase against the budget and the rules before money moves, then approves or blocks it.
- Issues a signed receipt for every approved purchase.
- Records every purchase in a double-entry ledger that cannot double-spend under concurrent load.
- Shows live spend per agent and category, blocks purchases in real time, and exports a full audit trail.

## Stack

- Amazon Aurora DSQL for the ledger, the budget counters, and the concurrency control.
- Next.js (App Router) with TypeScript and Tailwind CSS, deployed on Vercel.
- node-postgres (`pg`) with IAM authentication. Every database call runs on the Node.js runtime, never the Edge runtime, because a Postgres connection needs raw TCP.

## Why the ledger lives on DSQL

DSQL uses optimistic concurrency control. It checks for conflicts at commit time instead of taking row locks. Rein keeps a single `remaining_cents` counter on each budget row and updates it inside the same transaction as the purchase, so two purchases racing for the same budget collide on that one row. The first commit wins, the second gets a serialization error (SQLSTATE 40001) and is re-evaluated against the updated balance. That is what stops a budget from being overspent under load, which a naive sum-the-ledger design silently allows.

Money is stored as integer cents in `BIGINT`. Floats never touch a balance.

## Running locally

Requires Node 20 or newer and an Aurora DSQL cluster.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template and fill in your values:

   ```bash
   cp .env.example .env.local
   ```

   Set `AWS_REGION`, `DSQL_CLUSTER_ENDPOINT`, and your AWS credentials. `.env.local` is gitignored, keep it that way.

3. Apply the schema to the cluster:

   ```bash
   npm run migrate
   ```

4. Prove the connection works end to end:

   ```bash
   npm run health
   ```

   This runs a real query against the live cluster and prints the server time and a row count.

5. Start the app:

   ```bash
   npm run dev
   ```

   The same health check is exposed at `http://localhost:3000/api/health`.

## Layout

- `app/` Next.js routes, and the dashboard in later phases.
- `app/api/health/` the health check route handler.
- `lib/` the DSQL connection module, environment loading, and query helpers.
- `migrations/` the schema, one DDL statement per file.
- `scripts/` the migration runner and the standalone health check.
- `docs/` research, plan, and review notes.
- `test/` the test suite, added in later phases.

Author: Dhruv
