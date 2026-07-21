import os from "node:os";
import path from "node:path";
import { rm } from "node:fs/promises";

export default async function globalTeardown() {
  const target = process.env.ADFIX_TEST_DATA_ROOT;
  if (!target) return;
  const resolvedTarget = path.resolve(target);
  const resolvedTempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (!resolvedTarget.startsWith(resolvedTempRoot) || !path.basename(resolvedTarget).startsWith("adfix-pm-tests-")) {
    throw new Error(`Refusing to clean unexpected test data path: ${resolvedTarget}`);
  }
  await rm(resolvedTarget, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
