import { Router } from "express";
import { pool } from "../db/pool.js";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  let dbStatus: "ok" | "error" = "ok";

  try {
    await pool.query("SELECT 1");
  } catch {
    dbStatus = "error";
  }

  const statusCode = dbStatus === "ok" ? 200 : 503;
  const status = dbStatus === "ok" ? "ok" : "degraded";

  res.status(statusCode).json({
    status,
    service: "adfix-api",
    checks: {
      database: dbStatus
    },
    timestamp: new Date().toISOString()
  });
});
