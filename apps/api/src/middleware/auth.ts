import type { NextFunction, Response } from "express";
import { verifyAccessToken } from "../utils/tokens.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { sendError, sendUnauthorized } from "../utils/http-error.js";
import { pool } from "../db/pool.js";

function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = extractBearerToken(req.header("authorization"));
  if (!token) {
    return sendUnauthorized(res, "Missing bearer token");
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    return sendUnauthorized(res, "Invalid or expired token");
  }

  if (payload.tokenType !== "access") {
    return sendUnauthorized(res, "Invalid access token");
  }

  const activeUser = await pool.query<{
    id: string;
    email: string;
    name: string;
    is_admin: boolean;
    account_type: "staff" | "client";
    auth_version: number;
    must_change_password: boolean;
  }>(
    `SELECT id, email, name, is_admin, account_type, auth_version, must_change_password
     FROM users
     WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL
     LIMIT 1`,
    [payload.userId]
  );

  const user = activeUser.rows[0];
  if (!user) return sendUnauthorized(res, "Account is inactive or no longer exists");
  if (user.auth_version !== payload.authVersion) {
    return sendUnauthorized(res, "Session is no longer valid");
  }

  req.user = {
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.is_admin,
    accountType: user.account_type,
    mustChangePassword: user.must_change_password
  };

  const requestPath = req.originalUrl.split("?", 1)[0];
  const passwordChangeAllowed = req.method === "POST" && /\/users\/me\/change-password$/.test(requestPath);
  const sessionInspectionAllowed = req.method === "GET" && /\/auth\/me$/.test(requestPath);
  if (user.must_change_password && !passwordChangeAllowed && !sessionInspectionAllowed) {
    return sendError(
      res,
      403,
      "PASSWORD_CHANGE_REQUIRED",
      "Change the temporary password before accessing the workspace"
    );
  }

  return next();
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
