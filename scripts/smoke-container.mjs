import { spawnSync } from "node:child_process";

function runDocker(args, options = {}) {
  return spawnSync("docker", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    ...options
  });
}

const dockerVersion = runDocker(["version", "--format", "{{.Server.Version}}"]);
if (dockerVersion.status !== 0) {
  console.log("Container smoke test skipped: a running Docker engine was not found.");
  process.exit(0);
}

const suffix = `${Date.now()}-${process.pid}`;
const image = `adfix-pm-smoke:${suffix}`;
const container = `adfix-pm-smoke-${suffix}`;
let started = false;

try {
  console.log("Building the production container...");
  const build = runDocker(["build", "--pull=false", "-t", image, "."], { stdio: "inherit" });
  if (build.status !== 0) throw new Error("Container build failed");

  const launch = runDocker([
    "run", "-d", "--rm", "--name", container,
    "-p", "127.0.0.1::4000",
    "-e", "APP_ORIGIN=https://pm.example.test",
    "-e", "CORS_ALLOWED_ORIGINS=https://pm.example.test",
    "-e", "COOKIE_SECURE=true",
    "-e", "JWT_ACCESS_SECRET=container-smoke-access-secret-1234567890",
    "-e", "JWT_REFRESH_SECRET=container-smoke-refresh-secret-0987654321",
    "-e", "SEED_ADMIN_PASSWORD=ContainerSmokePassword123!",
    image
  ]);
  if (launch.status !== 0) throw new Error(launch.stderr || "Container did not start");
  started = true;

  let readinessUrl;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const portResult = runDocker(["port", container, "4000/tcp"]);
    const binding = portResult.stdout?.trim().split(/\r?\n/)[0];
    const port = binding?.match(/:(\d+)$/)?.[1];
    if (port) readinessUrl = `http://127.0.0.1:${port}/api/ready`;

    if (readinessUrl) {
      try {
        const response = await fetch(readinessUrl);
        if (response.ok) {
          const body = await response.json();
          if (body?.checks?.database === "ok" && body?.checks?.storage === "ok") {
            console.log(`Container smoke test passed: ${readinessUrl}`);
            process.exitCode = 0;
            break;
          }
        }
      } catch {
        // Startup can legitimately take several seconds while the embedded database migrates.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  if (process.exitCode !== 0) {
    const logs = runDocker(["logs", container]);
    throw new Error(`Container never became ready.\n${logs.stdout ?? ""}\n${logs.stderr ?? ""}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (started) runDocker(["rm", "-f", container]);
  runDocker(["image", "rm", "-f", image]);
}
