import type { Request, Response, NextFunction } from "express";

export function notFoundHandler(_req: Request, res: Response) {
  const requestId = res.getHeader("x-request-id");
  res.status(404).json({ error: "Not Found", requestId });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const message = err instanceof Error ? err.message : "Internal server error";
  const requestId = res.getHeader("x-request-id");
  res.status(500).json({ error: message, requestId });
}
