import type { Response } from "express";

type ErrorPayload = {
  code: string;
  error: string;
  requestId: string | null;
  details?: unknown;
};

export function sendError(
  res: Response,
  status: number,
  code: string,
  error: string,
  details?: unknown
) {
  const requestIdHeader = res.getHeader("x-request-id");
  const requestId = typeof requestIdHeader === "string" ? requestIdHeader : null;

  const payload: ErrorPayload = {
    code,
    error,
    requestId
  };

  if (typeof details !== "undefined") {
    payload.details = details;
  }

  return res.status(status).json(payload);
}

export function sendUnauthorized(res: Response, error = "Unauthorized") {
  return sendError(res, 401, "UNAUTHORIZED", error);
}

export function sendForbidden(res: Response, error = "Forbidden") {
  return sendError(res, 403, "FORBIDDEN", error);
}

export function sendNotFound(res: Response, error = "Not Found") {
  return sendError(res, 404, "NOT_FOUND", error);
}

export function sendConflict(res: Response, error = "Conflict") {
  return sendError(res, 409, "CONFLICT", error);
}
