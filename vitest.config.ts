import { defineConfig } from "vitest/config";

// Two projects in one run. The node project holds the live integration tests, which talk to the
// DSQL cluster, run serially, and load .env.local. The components project holds the rendering
// tests, which run in a DOM with no cluster. vitest 4 removed environmentMatchGlobs, so the split
// is expressed as projects. The file extension keeps them apart: .test.ts is node, .test.tsx is
// a component test, so there is no overlap.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["test/**/*.test.ts"],
          setupFiles: ["test/setup.ts"],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: {
          name: "components",
          environment: "happy-dom",
          include: ["test/**/*.test.tsx"],
          setupFiles: ["test/setup.dom.ts"],
        },
      },
    ],
  },
});
