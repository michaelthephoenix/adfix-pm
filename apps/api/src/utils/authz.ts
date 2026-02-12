import type { Response } from "express";
import type { AuthenticatedRequest } from "../types/http.js";
import { insertActivityLog } from "../services/activity-log.service.js";

export async function logAndSendForbidden(input: {
  req: AuthenticatedRequest;
  res: Response;
  permission: string;
  projectId?: string | null;
}) {
  if (input.req.user) {
    await insertActivityLog({
      userId: input.req.user.id,
      action: "authz_denied",
      projectId: input.projectId ?? null,
      details: {
        permission: input.permission,
        method: input.req.method,
        path: input.req.path
      }
    });
  }

  return input.res.status(403).json({ error: "Forbidden" });
}
