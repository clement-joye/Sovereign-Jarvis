import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: [
      "packages/**/*.test.ts",
      "plugins/**/*.test.ts",
      "apps/**/*.test.ts",
      "tests/**/*.test.ts"
    ]
  }
});
