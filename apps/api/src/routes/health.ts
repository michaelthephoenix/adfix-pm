import { Router } from "express";
import { pool } from "../db/pool.js";
import { ensureLocalStorageReady } from "../storage/storage-health.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "adfix-api",
    timestamp: new Date().toISOString()
  });
});

healthRouter.get("/ready", async (_req, res) => {
  let dbStatus: "ok" | "error" = "ok";
  let storageStatus: "ok" | "error" = "ok";

  try {
    await pool.query("SELECT 1");
  } catch {
    dbStatus = "error";
  }

  try {
    await ensureLocalStorageReady();
  } catch {
    storageStatus = "error";
  }

  const ready = dbStatus === "ok" && storageStatus === "ok";
  const statusCode = ready ? 200 : 503;
  const status = ready ? "ok" : "degraded";

  return res.status(statusCode).json({
    status,
    service: "adfix-api",
    checks: {
      database: dbStatus,
      storage: storageStatus
    },
    timestamp: new Date().toISOString()
  });
});
