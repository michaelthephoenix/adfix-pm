import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiSpec } from "../src/openapi/spec.js";

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
type OpenApiOperation = { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> };

const methods = new Set<HttpMethod>(["get", "post", "put", "patch", "delete"]);
const nonJsonSuccessTypes = new Map<string, string>([
  ["GET /docs", "text/html"],
  ["GET /analytics/projects.csv", "text/csv"],
  ["GET /analytics/team.csv", "text/csv"],
  ["GET /files/{id}/content", "*/*"],
  ["GET /files/{id}/preview", "*/*"]
]);

function normalizeRuntimePath(prefix: string, routePath: string) {
  const joined = `${prefix}${routePath === "/" ? "" : routePath}` || "/";
  return joined.replace(/:([A-Za-z][A-Za-z0-9_]*)/g, "{$1}");
}

async function runtimeOperations() {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const sourceRoot = path.resolve(currentDir, "../src");
  const appSource = await readFile(path.join(sourceRoot, "app.ts"), "utf8");
  const routerImports = new Map<string, string>();
  const importPattern = /import\s+\{\s*([A-Za-z0-9_]+Router)\s*\}\s+from\s+"\.\/routes\/([^".]+)\.js";/g;
  for (const match of appSource.matchAll(importPattern)) routerImports.set(match[1], match[2]);

  const mounts = new Map<string, string>();
  const usePattern = /app\.use\(([\s\S]*?)\);/g;
  for (const match of appSource.matchAll(usePattern)) {
    const argumentsSource = match[1];
    const routerName = [...routerImports.keys()].find((candidate) => new RegExp(`\\b${candidate}\\b`).test(argumentsSource));
    if (!routerName) continue;
    const templatePrefix = argumentsSource.match(/`\$\{basePath\}([^`]*)`/)?.[1];
    const prefix = typeof templatePrefix === "string" ? templatePrefix : /\bbasePath\b/.test(argumentsSource) ? "" : null;
    if (prefix !== null) mounts.set(routerName, prefix);
  }

  const operations = new Set<string>();
  for (const [routerName, prefix] of mounts) {
    const routeModule = routerImports.get(routerName);
    if (!routeModule) continue;
    const routeSource = await readFile(path.join(sourceRoot, "routes", `${routeModule}.ts`), "utf8");
    const routePattern = new RegExp(`${routerName}\\.(get|post|put|patch|delete)\\(\\s*[\"'\`]([^\"'\`]+)[\"'\`]`, "g");
    for (const match of routeSource.matchAll(routePattern)) {
      operations.add(`${match[1].toUpperCase()} ${normalizeRuntimePath(prefix, match[2])}`);
    }
  }
  return operations;
}

function documentedOperations(spec: ReturnType<typeof buildOpenApiSpec>) {
  const operations = new Set<string>();
  for (const [routePath, pathItem] of Object.entries(spec.paths as Record<string, Record<string, unknown>>)) {
    for (const method of Object.keys(pathItem)) {
      if (methods.has(method as HttpMethod)) operations.add(`${method.toUpperCase()} ${routePath}`);
    }
  }
  return operations;
}

function setDifference(left: Set<string>, right: Set<string>) {
  return [...left].filter((value) => !right.has(value)).sort();
}

export async function validateOpenApiContract(spec = buildOpenApiSpec("http://localhost:4000/api/v1")) {
  const runtime = await runtimeOperations();
  const documented = documentedOperations(spec);
  const missing = setDifference(runtime, documented);
  const extra = setDifference(documented, runtime);
  const problems: string[] = [];
  if (missing.length) problems.push(`Runtime operations missing from OpenAPI:\n- ${missing.join("\n- ")}`);
  if (extra.length) problems.push(`OpenAPI operations missing at runtime:\n- ${extra.join("\n- ")}`);

  const schemas = spec.components.schemas as Record<string, unknown>;
  for (const [routePath, pathItem] of Object.entries(spec.paths as Record<string, Record<string, unknown>>)) {
    for (const [method, operationValue] of Object.entries(pathItem)) {
      if (!methods.has(method as HttpMethod)) continue;
      const operation = operationValue as OpenApiOperation;
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (!/^2\d\d$/.test(status)) continue;
        const operationKey = `${method.toUpperCase()} ${routePath}`;
        if (status === "204") {
          if (response.content && Object.keys(response.content).length) problems.push(`${operationKey} 204 must not declare response content`);
          continue;
        }
        const expectedContentType = nonJsonSuccessTypes.get(operationKey) ?? "application/json";
        const media = response.content?.[expectedContentType];
        if (!media?.schema) {
          problems.push(`${operationKey} ${status} must declare ${expectedContentType} response content with a schema`);
          continue;
        }
        if (expectedContentType === "application/json") {
          const reference = (media.schema as { $ref?: string }).$ref;
          if (!reference?.startsWith("#/components/schemas/")) {
            problems.push(`${operationKey} ${status} JSON response must use a reusable component schema`);
            continue;
          }
          const schemaName = reference.slice("#/components/schemas/".length);
          if (!schemas[schemaName]) problems.push(`${operationKey} ${status} references missing schema ${schemaName}`);
        }
      }
    }
  }

  if (problems.length) throw new Error(problems.join("\n\n"));
  return { runtimeOperationCount: runtime.size, documentedOperationCount: documented.size };
}

async function run() {
  const result = await validateOpenApiContract();
  console.log(`OpenAPI contract valid: ${result.documentedOperationCount} documented operations match runtime.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
