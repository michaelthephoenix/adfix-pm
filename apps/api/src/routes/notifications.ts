import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../types/http.js";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from "../services/notifications.service.js";
import { sendNotFound, sendUnauthorized } from "../utils/http-error.js";
import { sendValidationError } from "../utils/validation.js";

export const notificationsRouter = Router();

const notificationsListQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc")
});

const idParamsSchema = z.object({
  id: z.string().uuid()
});

notificationsRouter.use(requireAuth);

notificationsRouter.get("/", async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const parsedQuery = notificationsListQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return sendValidationError(res, "Invalid notifications query", parsedQuery.error);
  }

  const result = await listNotifications({
    userId: req.user.id,
    unreadOnly: parsedQuery.data.unreadOnly,
    page: parsedQuery.data.page,
    pageSize: parsedQuery.data.pageSize,
    sortOrder: parsedQuery.data.sortOrder
  });

  return res.status(200).json({
    data: result.rows,
    meta: {
      page: parsedQuery.data.page,
      pageSize: parsedQuery.data.pageSize,
      sortOrder: parsedQuery.data.sortOrder,
      total: result.total,
      unreadCount: result.unreadCount
    }
  });
});

notificationsRouter.patch("/:id/read", async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid notification id", parsedParams.error);
  }

  const notification = await markNotificationRead(parsedParams.data.id, req.user.id);
  if (!notification) {
    return sendNotFound(res, "Notification not found");
  }

  return res.status(200).json({ data: notification });
});

notificationsRouter.post("/read-all", async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const result = await markAllNotificationsRead(req.user.id);
  return res.status(200).json({ data: result });
});
