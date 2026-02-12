import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const headerId = req.header("x-request-id");
  const requestId = headerId && headerId.trim().length > 0 ? headerId : randomUUID();

  res.setHeader("x-request-id", requestId);
  res.locals.requestId = requestId;

  next();
}
