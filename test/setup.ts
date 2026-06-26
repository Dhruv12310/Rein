import { loadEnvConfig } from "@next/env";

// These are live integration tests that read the real cluster credentials from .env.local.
// @next/env intentionally skips .env.local when NODE_ENV is "test", which vitest sets, so load
// the environment as if outside test mode and then restore it. Next types process.env.NODE_ENV
// as read-only, so the brief toggle goes through a plain-record view. loadEnvConfig is
// synchronous, so nothing else observes the change, and nothing here depends on NODE_ENV.
const env = process.env as Record<string, string | undefined>;
const previousNodeEnv = env.NODE_ENV ?? "test";
env.NODE_ENV = "development";
loadEnvConfig(process.cwd());
env.NODE_ENV = previousNodeEnv;
