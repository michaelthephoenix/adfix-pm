import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      PGLITE_DATA_DIR: ".data/pglite-test",
      LOCAL_UPLOAD_DIR: ".data/uploads-test"
    },
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
