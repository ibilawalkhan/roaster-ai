import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // PGlite boots a WASM Postgres per suite; give it room on cold start / CI.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
