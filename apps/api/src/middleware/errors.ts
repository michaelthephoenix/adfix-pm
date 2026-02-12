import type { Request, Response, NextFunction } from "express";
import { sendError } from "../utils/http-error.js";

export function notFoundHandler(_req: Request, res: Response) {
  return sendError(res, 404, "NOT_FOUND", "Not Found");
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const message = err instanceof Error ? err.message : "Internal server error";
  return sendError(res, 500, "INTERNAL_ERROR", message);
}
