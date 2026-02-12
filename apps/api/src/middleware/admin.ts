import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../types/http.js";
import { logAndSendForbidden } from "../utils/authz.js";

export async function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!req.user.isAdmin) {
    return logAndSendForbidden({
      req,
      res,
      permission: "admin:access",
      projectId: null
    });
  }

  return next();
}
