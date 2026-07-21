import { defineConfig } from "vitest/config";
import os from "node:os";
import path from "node:path";

const testRunId = `${process.pid}-${Date.now()}`;
const testDataRoot = path.join(os.tmpdir(), `adfix-pm-tests-${testRunId}`);

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      PGLITE_DATA_DIR: process.env.PGLITE_DATA_DIR ?? path.join(testDataRoot, "pglite"),
      LOCAL_UPLOAD_DIR: process.env.LOCAL_UPLOAD_DIR ?? path.join(testDataRoot, "uploads"),
      ADFIX_TEST_DATA_ROOT: process.env.ADFIX_TEST_DATA_ROOT ?? testDataRoot
    },
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    globalTeardown: ["tests/global-teardown.ts"],
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
