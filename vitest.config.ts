import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    // These are integration tests against the live DSQL cluster, there is no local emulator.
    // Run files in order so concurrent-load tests do not fight each other for connections, and
    // give live network calls and the retry path room before timing out.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
