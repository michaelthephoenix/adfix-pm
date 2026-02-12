import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiSpec } from "../src/openapi/spec.js";

function assertSpecShape(spec: ReturnType<typeof buildOpenApiSpec>) {
  if (spec.openapi !== "3.0.3") {
    throw new Error("OpenAPI version must be 3.0.3");
  }

  const requiredPaths = [
    "/health",
    "/ready",
    "/auth/login",
    "/users/audit-logs",
    "/tasks/{id}/comments"
  ];
  const paths = spec.paths as Record<string, unknown>;
  for (const requiredPath of requiredPaths) {
    if (!paths[requiredPath]) {
      throw new Error(`Missing required OpenAPI path: ${requiredPath}`);
    }
  }

  if (!spec.components?.schemas?.ErrorResponse) {
    throw new Error("Missing ErrorResponse schema");
  }
}

async function run() {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);
  const outputDir = path.resolve(currentDir, "../openapi");
  const outputPath = path.join(outputDir, "openapi.v1.json");

  const spec = buildOpenApiSpec("http://localhost:4000/api/v1");
  assertSpecShape(spec);

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(spec, null, 2)}\n`, "utf-8");

  console.log(`Exported OpenAPI spec: ${outputPath}`);
}

run().catch((error) => {
  console.error("OpenAPI export failed:", error);
  process.exitCode = 1;
});
