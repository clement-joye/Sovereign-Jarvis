import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    globals: false,
    hookTimeout: 180_000,
    include: ["compose/*.system.ts"],
    testTimeout: 120_000
  }
});
