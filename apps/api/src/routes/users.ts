import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { insertActivityLog } from "../services/activity-log.service.js";
import {
  getUserById,
  listAuditLogs,
  listUsers,
  resetUserProjectRoles,
  setUserActiveStatus,
  updateUserProfile
} from "../services/users.service.js";
import { sendConflict, sendForbidden, sendNotFound, sendUnauthorized } from "../utils/http-error.js";
import { sendValidationError } from "../utils/validation.js";

export const usersRouter = Router();

const idParamsSchema = z.object({
  id: z.string().uuid()
});

const usersListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  sortBy: z.enum(["createdAt", "updatedAt", "name", "email", "lastLoginAt"]).optional().default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("asc")
});

const auditLogsQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  action: z.string().trim().min(1).max(100).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  sortBy: z.enum(["createdAt", "action"]).optional().default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc")
});

const userUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    avatarUrl: z.string().trim().url().max(2048).optional().nullable()
  })
  .refine((value) => typeof value.name !== "undefined" || typeof value.avatarUrl !== "undefined", {
    message: "At least one field is required"
  });

const userStatusUpdateSchema = z.object({
  isActive: z.boolean()
});

const resetRolesSchema = z.object({
  projectId: z.string().uuid().optional()
});

usersRouter.use(requireAuth);

usersRouter.get("/", async (req, res) => {
  const parsedQuery = usersListQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return sendValidationError(res, "Invalid users query", parsedQuery.error);
  }

  const result = await listUsers(parsedQuery.data);
  return res.status(200).json({
    data: result.rows,
    meta: {
      page: parsedQuery.data.page,
      pageSize: parsedQuery.data.pageSize,
      sortBy: parsedQuery.data.sortBy,
      sortOrder: parsedQuery.data.sortOrder,
      total: result.total
    }
  });
});

usersRouter.get("/audit-logs", requireAdmin, async (req, res) => {
  const parsedQuery = auditLogsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return sendValidationError(res, "Invalid audit logs query", parsedQuery.error);
  }

  const result = await listAuditLogs(parsedQuery.data);
  return res.status(200).json({
    data: result.rows,
    meta: {
      page: parsedQuery.data.page,
      pageSize: parsedQuery.data.pageSize,
      sortBy: parsedQuery.data.sortBy,
      sortOrder: parsedQuery.data.sortOrder,
      total: result.total
    }
  });
});

usersRouter.get("/:id", async (req, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid user id", parsedParams.error);
  }

  const user = await getUserById(parsedParams.data.id);
  if (!user) {
    return sendNotFound(res, "User not found");
  }

  return res.status(200).json({ data: user });
});

usersRouter.patch("/:id/status", requireAdmin, async (req: AuthenticatedRequest, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid user id", parsedParams.error);
  }

  const parsedBody = userStatusUpdateSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return sendValidationError(res, "Invalid user status payload", parsedBody.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  if (req.user.id === parsedParams.data.id && parsedBody.data.isActive === false) {
    return sendConflict(res, "Admin cannot deactivate their own account");
  }

  const updatedUser = await setUserActiveStatus(parsedParams.data.id, parsedBody.data.isActive);
  if (!updatedUser) {
    return sendNotFound(res, "User not found");
  }

  await insertActivityLog({
    userId: req.user.id,
    action: "user_status_changed",
    projectId: null,
    details: {
      targetUserId: parsedParams.data.id,
      isActive: parsedBody.data.isActive
    }
  });

  return res.status(200).json({ data: updatedUser });
});

usersRouter.post("/:id/project-roles/reset", requireAdmin, async (req: AuthenticatedRequest, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid user id", parsedParams.error);
  }

  const parsedBody = resetRolesSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return sendValidationError(res, "Invalid role reset payload", parsedBody.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const targetUser = await getUserById(parsedParams.data.id);
  if (!targetUser) {
    return sendNotFound(res, "User not found");
  }

  const result = await resetUserProjectRoles(parsedParams.data.id, parsedBody.data.projectId);

  await insertActivityLog({
    userId: req.user.id,
    action: "user_project_roles_reset",
    projectId: parsedBody.data.projectId ?? null,
    details: {
      targetUserId: parsedParams.data.id,
      projectId: parsedBody.data.projectId ?? null,
      removedCount: result.removedCount
    }
  });

  return res.status(200).json({
    data: {
      removedCount: result.removedCount,
      projectIds: result.projectIds
    }
  });
});

usersRouter.put("/:id", async (req: AuthenticatedRequest, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid user id", parsedParams.error);
  }

  const parsedBody = userUpdateSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return sendValidationError(res, "Invalid user payload", parsedBody.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  if (req.user.id !== parsedParams.data.id) {
    return sendForbidden(res, "You can only update your own profile");
  }

  const user = await updateUserProfile(parsedParams.data.id, parsedBody.data);
  if (!user) {
    return sendNotFound(res, "User not found");
  }

  return res.status(200).json({ data: user });
});
