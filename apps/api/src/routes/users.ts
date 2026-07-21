import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireStaff } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { insertActivityLog } from "../services/activity-log.service.js";
import {
  createStaffUser,
  changeOwnPassword,
  getUserById,
  issueTemporaryPassword,
  listAuditLogs,
  listUsers,
  resetUserProjectRoles,
  setUserActiveStatus,
  updateUserProfile
} from "../services/users.service.js";
import { sendConflict, sendError, sendForbidden, sendNotFound, sendUnauthorized } from "../utils/http-error.js";
import { sendValidationError } from "../utils/validation.js";
import { clearRefreshCookie } from "../utils/auth-cookie.js";

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

const strongPasswordSchema = z.string().min(12).max(128)
  .regex(/[a-z]/, "Password must include a lowercase letter")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/[0-9]/, "Password must include a number");

const createStaffUserSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(255),
  password: strongPasswordSchema,
  isAdmin: z.boolean().optional().default(false)
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: strongPasswordSchema
});

const adminPasswordResetSchema = z.object({
  email: z.string().trim().email()
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

usersRouter.post("/me/change-password", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  const parsedBody = changePasswordSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return sendValidationError(res, "Invalid password change payload", parsedBody.error);
  }

  const result = await changeOwnPassword({ userId: req.user.id, ...parsedBody.data });
  if (result === "not_found") return sendNotFound(res, "User not found");
  if (result === "invalid_current_password") {
    return sendError(res, 400, "CURRENT_PASSWORD_INCORRECT", "Current password is incorrect");
  }
  if (result === "password_reused") {
    return sendError(res, 409, "PASSWORD_REUSE", "New password must be different from the current password");
  }

  clearRefreshCookie(res);
  res.setHeader("Cache-Control", "no-store");
  return res.status(204).send();
});

usersRouter.post("/admin/password-reset", requireAdmin, async (req: AuthenticatedRequest, res) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  const parsedBody = adminPasswordResetSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return sendValidationError(res, "Invalid password reset payload", parsedBody.error);
  }

  const result = await issueTemporaryPassword({ actorUserId: req.user.id, email: parsedBody.data.email });
  if (result === "not_found") return sendNotFound(res, "User not found");
  if (result === "self_reset") {
    return sendConflict(res, "Use Change password to update your own account");
  }
  if (result === "inactive") {
    return sendConflict(res, "Reactivate this account before issuing a temporary password");
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  return res.status(200).json({ data: result });
});

usersRouter.get("/", requireStaff, async (req, res) => {
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

usersRouter.post("/", requireAdmin, async (req: AuthenticatedRequest, res) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  const parsedBody = createStaffUserSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return sendValidationError(res, "Invalid staff account payload", parsedBody.error);
  }

  const createdUser = await createStaffUser(parsedBody.data);
  if (createdUser === "email_taken") return sendConflict(res, "Email is already registered");

  await insertActivityLog({
    userId: req.user.id,
    action: "staff_user_created",
    projectId: null,
    details: {
      targetUserId: createdUser.id,
      email: createdUser.email,
      isAdmin: createdUser.is_admin
    }
  });

  return res.status(201).json({ data: createdUser });
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

usersRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid user id", parsedParams.error);
  }

  if (!req.user || (req.user.accountType !== "staff" && req.user.id !== parsedParams.data.id)) {
    return sendForbidden(res, "You can only view your own profile");
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
