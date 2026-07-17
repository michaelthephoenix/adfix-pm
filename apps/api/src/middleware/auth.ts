import type { NextFunction, Response } from "express";
import { verifyAccessToken } from "../utils/tokens.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { sendUnauthorized } from "../utils/http-error.js";

function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = extractBearerToken(req.header("authorization"));
  if (!token) {
    return sendUnauthorized(res, "Missing bearer token");
  }

  try {
    const payload = verifyAccessToken(token);
    if (payload.tokenType !== "access") {
      return sendUnauthorized(res, "Invalid access token");
    }

    req.user = {
      id: payload.userId,
      email: payload.email,
      name: payload.name,
      isAdmin: payload.isAdmin,
      accountType: payload.accountType
    };

    return next();
  } catch {
    return sendUnauthorized(res, "Invalid or expired token");
  }
}

export function requireStaff(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  if (req.user.accountType !== "staff") {
    return res.status(403).json({ code: "FORBIDDEN", error: "Staff access required" });
  }
  return next();
}

export function requireClient(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  if (req.user.accountType !== "client") {
    return res.status(403).json({ code: "FORBIDDEN", error: "Client access required" });
  }
  return next();
}
