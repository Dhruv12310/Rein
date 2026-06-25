import { loadEnvConfig } from "@next/env";
import { closePool } from "../lib/db";
import { runHealthCheck } from "../lib/health";

// Load .env.local the same way the Next app does, so the script and the app read one env.
loadEnvConfig(process.cwd());

async function main() {
  const health = await runHealthCheck();
  console.log("DSQL health check passed.");
  console.log(`  server time: ${health.now}`);
  console.log(`  agents rows: ${health.agents}`);
}

main()
  .catch((err) => {
    console.error("DSQL health check failed.");
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(closePool);
