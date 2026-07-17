import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import type { StorageProvider } from "./storage-provider.js";

function safeExtension(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : "";
}

function resolveWithinRoot(objectKey: string) {
  const root = path.resolve(env.LOCAL_UPLOAD_DIR);
  const resolved = path.resolve(root, objectKey);
  const prefix = `${root}${path.sep}`;

  if (!resolved.startsWith(prefix)) {
    throw new Error("Invalid storage object key");
  }

  return resolved;
}

export const localStorageProvider: StorageProvider = {
  async save(input) {
    await mkdir(env.LOCAL_UPLOAD_DIR, { recursive: true });
    const objectKey = `${randomUUID()}${safeExtension(input.fileName)}`;
    const target = resolveWithinRoot(objectKey);
    await writeFile(target, input.buffer, { flag: "wx" });

    return {
      objectKey,
      checksumSha256: createHash("sha256").update(input.buffer).digest("hex"),
      size: input.buffer.byteLength
    };
  },

  async resolve(objectKey) {
    return resolveWithinRoot(objectKey);
  },

  async delete(objectKey) {
    await rm(resolveWithinRoot(objectKey), { force: true });
  }
};

export const storageProvider = localStorageProvider;
