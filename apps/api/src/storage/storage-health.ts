import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { env } from "../config/env.js";

/**
 * Ensures the local storage root exists and the running process can use it.
 * Calling this during startup fails fast instead of waiting for the first upload.
 */
export async function ensureLocalStorageReady() {
  await mkdir(env.LOCAL_UPLOAD_DIR, { recursive: true });
  await access(env.LOCAL_UPLOAD_DIR, constants.R_OK | constants.W_OK);
}
