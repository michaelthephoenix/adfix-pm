import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function stopProcess(pid: number | undefined) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try { process.kill(-pid, "SIGTERM"); } catch { /* Already stopped. */ }
  }
}

export default async function globalTeardown() {
  const root = process.env.ADFIX_E2E_DATA_ROOT;
  const pidFile = process.env.ADFIX_E2E_PID_FILE;
  if (!root || !pidFile) return;
  try {
    const pids = JSON.parse(await readFile(pidFile, "utf8")) as { api?: number; web?: number };
    stopProcess(pids.api);
    stopProcess(pids.web);
  } finally {
    const resolved = path.resolve(root);
    const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
    if (!resolved.startsWith(tempRoot) || !path.basename(resolved).startsWith("adfix-pm-e2e-")) {
      throw new Error(`Refusing to remove an unsafe E2E data path: ${resolved}`);
    }
    await rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
}
