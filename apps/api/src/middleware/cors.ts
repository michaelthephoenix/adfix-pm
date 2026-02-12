import type { NextFunction, Response } from "express";
import { env } from "../config/env.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { sendError } from "../utils/http-error.js";

const DEFAULT_ALLOWED_HEADERS = "Authorization,Content-Type,X-Request-Id";
const ALLOWED_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const EXPOSED_HEADERS = "x-request-id";

const configuredOrigins = env.CORS_ALLOWED_ORIGINS
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isOriginAllowed(origin: string) {
  return configuredOrigins.includes("*") || configuredOrigins.includes(origin);
}

export function corsMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const origin = req.header("origin");

  if (origin) {
    if (!isOriginAllowed(origin)) {
      return sendError(res, 403, "CORS_ORIGIN_DENIED", "Origin is not allowed by CORS policy");
    }

    res.setHeader("Access-Control-Allow-Origin", configuredOrigins.includes("*") ? "*" : origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
    res.setHeader(
      "Access-Control-Allow-Headers",
      req.header("access-control-request-headers") ?? DEFAULT_ALLOWED_HEADERS
    );
    res.setHeader("Access-Control-Expose-Headers", EXPOSED_HEADERS);
  }

  if (req.method === "OPTIONS") {
    return res.status(204).send();
  }

  return next();
}
