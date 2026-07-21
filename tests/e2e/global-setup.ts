import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function stopProcess(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already stopped. */ }
  }
}

async function waitFor(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The disposable services are still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export default async function globalSetup() {
  const dataRoot = process.env.ADFIX_E2E_DATA_ROOT;
  const pidFile = process.env.ADFIX_E2E_PID_FILE;
  if (!dataRoot || !pidFile) throw new Error("E2E data paths were not configured");
  await mkdir(dataRoot, { recursive: true });

  const root = process.cwd();
  const detached = process.platform !== "win32";
  const api = spawn(process.execPath, ["--import", "tsx", path.join(root, "apps/api/src/server.ts")], {
    cwd: root,
    detached,
    stdio: "ignore",
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: "4100",
      APP_ORIGIN: "http://localhost:5174",
      CORS_ALLOWED_ORIGINS: "http://localhost:5174",
      AUTH_RATE_LIMIT_MAX: "1000",
      REFRESH_RATE_LIMIT_MAX: "1000",
      API_RATE_LIMIT_MAX: "10000",
      SEED_PROFILE: "demo",
      PGLITE_DATA_DIR: path.join(dataRoot, "pglite"),
      LOCAL_UPLOAD_DIR: path.join(dataRoot, "uploads")
    }
  });
  const web = spawn(process.execPath, [
    path.join(root, "node_modules/vite/bin/vite.js"),
    "apps/web",
    "--config", "apps/web/vite.config.ts",
    "--port", "5174"
  ], {
    cwd: root,
    detached,
    stdio: "ignore",
    env: { ...process.env, VITE_API_PROXY_TARGET: "http://127.0.0.1:4100" }
  });
  api.unref();
  web.unref();

  try {
    await Promise.all([
      waitFor("http://127.0.0.1:4100/api/ready", 120_000),
      waitFor("http://localhost:5174/login", 60_000)
    ]);
    await writeFile(pidFile, JSON.stringify({ api: api.pid, web: web.pid }), "utf8");
  } catch (error) {
    stopProcess(api);
    stopProcess(web);
    throw error;
  }
}
