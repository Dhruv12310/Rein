import { AuroraDSQLPool } from "@aws/aurora-dsql-node-postgres-connector";
import type { Pool, QueryResult, QueryResultRow } from "pg";
import { readDbEnv } from "./env";

// This module talks raw TCP to Postgres, so it must only ever run on the Node.js runtime.
// Every route handler or script that imports it pins `export const runtime = "nodejs"`.

// AuroraDSQLPool is AWS's official connector. It extends pg's Pool and mints a fresh IAM
// auth token for every new physical connection, so a long-lived pool never reuses an expired
// token. It also enforces TLS itself, which is why I do not pass an ssl option here.

const globalForDb = globalThis as unknown as { reinPool?: Pool };

function buildPool(): Pool {
  const env = readDbEnv();
  const pool: Pool = new AuroraDSQLPool({
    host: env.endpoint,
    user: env.user, // "admin" selects the admin token, any other role uses the standard one
    database: env.database,
    // Pass region explicitly. The connector can parse it from the hostname, but I would
    // rather not depend on the endpoint format staying fixed.
    region: env.region,
    tokenDurationSecs: env.tokenExpirySeconds,
    // The app layer stays light and stateless; DSQL scales the backend. A small pool is enough.
    // Idle connections recycle well before DSQL's hard 60 minute per-connection limit.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // An idle pooled client erroring should not take down the process. Log and let pg recycle it.
  pool.on("error", (err) => {
    console.error("Unexpected database pool error", err);
  });
  return pool;
}

// Cache the pool on globalThis so dev hot reloads and repeated invocations reuse one pool
// instead of leaking a new one each time.
export function getPool(): Pool {
  if (!globalForDb.reinPool) {
    globalForDb.reinPool = buildPool();
  }
  return globalForDb.reinPool;
}

// Close the pool so a standalone script can exit. The pool keeps the event loop alive,
// so migrate and health call this when they finish.
export async function closePool(): Promise<void> {
  if (globalForDb.reinPool) {
    await globalForDb.reinPool.end();
    globalForDb.reinPool = undefined;
  }
}

// Thin query helper so callers do not each reach into the pool.
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params as unknown[]);
}
