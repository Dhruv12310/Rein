import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadEnvConfig } from "@next/env";
import type { PoolClient } from "pg";
import { closePool, getPool } from "../lib/db";

// Load .env.local the same way the Next app does, so the script and the app read one env.
loadEnvConfig(process.cwd());

const migrationsDir = join(process.cwd(), "migrations");

// DSQL bumps a catalog version on every DDL, and a session holding a stale catalog can get a
// serialization error (SQLSTATE 40001, sub-code OC001) on its next statement. Running every
// migration on one connection avoids most of that; this retry covers the rest.
async function runWithRetry(
  client: PoolClient,
  sql: string,
  params: unknown[] = [],
  attempts = 5,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await client.query(sql, params);
      return;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "40001" && attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
        continue;
      }
      throw err;
    }
  }
}

async function main() {
  // One dedicated connection for the whole run, so each DDL it commits is visible to the next.
  const client = await getPool().connect();
  try {
    // Track applied migrations so re-running this is safe. One DDL on its own transaction.
    await runWithRetry(
      client,
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ DEFAULT now()
       )`,
    );

    const { rows } = await client.query<{ version: string }>(
      "SELECT version FROM schema_migrations",
    );
    const applied = new Set(rows.map((r) => r.version));

    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    let count = 0;
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      if (applied.has(version)) {
        console.log(`skip   ${version}`);
        continue;
      }
      const sql = await readFile(join(migrationsDir, file), "utf8");
      // pg runs each statement in its own implicit transaction here, so the CREATE is one DDL
      // alone and recording it as applied is a separate DML statement. DSQL needs that split.
      await runWithRetry(client, sql);
      await runWithRetry(client, "INSERT INTO schema_migrations (version) VALUES ($1)", [
        version,
      ]);
      console.log(`apply  ${version}`);
      count++;
    }

    console.log(
      count === 0 ? "Schema already up to date." : `Applied ${count} migration(s).`,
    );
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error("Migration failed.");
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closePool);
