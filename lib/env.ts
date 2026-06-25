// Single place to read and validate the environment the database layer needs.
// I fail loudly here so a missing endpoint or region surfaces as one clear error
// instead of a confusing TLS or auth failure deeper in the connection.

export type DbEnv = {
  region: string;
  endpoint: string;
  database: string;
  user: string;
  tokenExpirySeconds: number;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value.trim();
}

export function readDbEnv(): DbEnv {
  return {
    region: required("AWS_REGION"),
    endpoint: required("DSQL_CLUSTER_ENDPOINT"),
    database: process.env.DSQL_DATABASE?.trim() || "postgres",
    user: process.env.DSQL_USER?.trim() || "admin",
    tokenExpirySeconds: Number(process.env.DSQL_TOKEN_EXPIRY_SECONDS) || 900,
  };
}
