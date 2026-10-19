import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // pack.test.ts runs real pnpm installs and packs per test.
    testTimeout: 60_000,
  },
});
