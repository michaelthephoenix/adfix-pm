import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const e2eDataRoot = path.join(os.tmpdir(), `adfix-pm-e2e-${process.pid}`);
process.env.ADFIX_E2E_DATA_ROOT = e2eDataRoot;
process.env.ADFIX_E2E_PID_FILE = path.join(e2eDataRoot, "servers.json");
const browserChannel = process.env.PLAYWRIGHT_CHANNEL || (process.platform === "win32" ? "chrome" : undefined);

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Every browser journey intentionally shares the same embedded PostgreSQL
  // instance. Keep the suite serial so concurrent seed/login writes cannot
  // make otherwise-valid local-first workflows flaky.
  workers: 1,
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  use: {
    baseURL: "http://localhost:5174",
    channel: browserChannel,
    colorScheme: "dark",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: browserChannel } },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: browserChannel } }
  ],
});
