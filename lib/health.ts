import { query } from "./db";

export type HealthResult = {
  ok: true;
  now: string; // server clock from the cluster, proof the round trip is live
  agents: number; // row count from a migrated table, proof the schema is there
};

// One real round trip to the cluster: ask for the server clock and a count from a table the
// migration created. If either fails, the connection or the schema is not ready, and the
// caller turns that into a clear failure.
export async function runHealthCheck(): Promise<HealthResult> {
  const result = await query<{ now: string; agents: string }>(
    "select now()::text as now, (select count(*) from agents) as agents",
  );
  const row = result.rows[0];
  return {
    ok: true,
    now: row.now,
    agents: Number(row.agents),
  };
}
