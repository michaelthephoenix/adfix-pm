import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import { sendError } from "../utils/http-error.js";

export function notFoundHandler(_req: Request, res: Response) {
  return sendError(res, 404, "NOT_FOUND", "Not Found");
}

export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(err);

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") return sendError(res, 413, "FILE_TOO_LARGE", "Files must be 50 MB or smaller");
    return sendError(res, 400, "UPLOAD_ERROR", err.message);
  }
  if (err instanceof Error && err.message === "Unsupported file type") {
    return sendError(res, 415, "UNSUPPORTED_FILE_TYPE", err.message);
  }

  const requestId = res.getHeader("x-request-id");
  console.error("Unhandled API error", {
    requestId: typeof requestId === "string" ? requestId : null,
    method: req.method,
    path: req.originalUrl,
    error: err instanceof Error
      ? { name: err.name, message: err.message, stack: err.stack }
      : { value: String(err) }
  });

  const message = process.env.NODE_ENV === "production"
    ? "Internal server error"
    : err instanceof Error
      ? err.message
      : "Internal server error";
  return sendError(res, 500, "INTERNAL_ERROR", message);
}
