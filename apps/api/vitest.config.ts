import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 40,
        statements: 60
      }
    }
  }
});
