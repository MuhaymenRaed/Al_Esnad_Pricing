import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "lib/**/*.test.ts", "features/**/*.test.{ts,tsx}"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: "forks",
    // Each DB test file boots its own in-memory Postgres (PGlite, WASM). Too many
    // at once can crash a worker on Windows, so keep concurrency modest.
    maxWorkers: 3,
  },
});
