import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireClient } from "../middleware/auth.js";
import { getClientPortalProject, getClientVersionAccessRole, listClientPortalProjects } from "../services/client-portal.service.js";
import { reviewDeliverableVersion } from "../services/deliverables.service.js";
import { createNotification } from "../services/notifications.service.js";
import { pool } from "../db/pool.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { sendConflict, sendForbidden, sendNotFound, sendUnauthorized } from "../utils/http-error.js";
import { sendValidationError } from "../utils/validation.js";
import { insertActivityLog } from "../services/activity-log.service.js";

export const clientPortalRouter = Router();
clientPortalRouter.use(requireAuth, requireClient);

const projectSchema = z.object({ projectId: z.string().uuid() });
const versionSchema = z.object({ versionId: z.string().uuid() });
const reviewSchema = z.object({
  decision: z.enum(["approved", "changes_requested"]),
  comment: z.string().trim().max(4000).optional().nullable()
}).superRefine((value, context) => {
  if (value.decision === "changes_requested" && !value.comment) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["comment"], message: "A comment is required" });
  }
});

clientPortalRouter.get("/projects", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  return res.status(200).json({ data: await listClientPortalProjects(req.user.id) });
});

clientPortalRouter.get("/projects/:projectId", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  const parsed = projectSchema.safeParse(req.params);
  if (!parsed.success) return sendValidationError(res, "Invalid project id", parsed.error);
  const project = await getClientPortalProject(parsed.data.projectId, req.user.id);
  return project ? res.status(200).json({ data: project }) : sendNotFound(res, "Project not found");
});

clientPortalRouter.post("/versions/:versionId/reviews", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  const parsedId = versionSchema.safeParse(req.params);
  const parsedBody = reviewSchema.safeParse(req.body);
  if (!parsedId.success) return sendValidationError(res, "Invalid version id", parsedId.error);
  if (!parsedBody.success) return sendValidationError(res, "Invalid review", parsedBody.error);
  const accessRole = await getClientVersionAccessRole(req.user.id, parsedId.data.versionId);
  if (!accessRole) return sendNotFound(res, "Deliverable version not found");
  if (accessRole === "viewer") return sendForbidden(res, "Viewer access is read-only");
  const result = await reviewDeliverableVersion({ versionId: parsedId.data.versionId, reviewerId: req.user.id, ...parsedBody.data });
  if (!result.ok) {
    if (result.reason === "delivery_locked") return sendConflict(res, "Reviews are closed after Delivery");
    if (result.reason === "not_latest") return sendConflict(res, "Only the latest version can be reviewed");
    return sendNotFound(res, "Deliverable version not found");
  }

  const recipients = await pool.query<{ user_id: string }>(
    `SELECT created_by AS user_id FROM projects WHERE id = $1
     UNION SELECT user_id FROM project_team WHERE project_id = $1`,
    [result.access.project_id]
  );
  await Promise.all(recipients.rows.map(({ user_id }) => createNotification({
    userId: user_id,
    projectId: result.access.project_id,
    type: `deliverable_${parsedBody.data.decision}`,
    title: parsedBody.data.decision === "approved" ? "Deliverable approved" : "Changes requested",
    message: `${req.user?.name} reviewed ${result.access.title}.`,
    metadata: { versionId: parsedId.data.versionId, decision: parsedBody.data.decision }
  })));
  await insertActivityLog({
    userId: req.user.id,
    projectId: result.access.project_id,
    action: `deliverable_${parsedBody.data.decision}`,
    details: { versionId: parsedId.data.versionId, deliverableId: result.access.deliverable_id, comment: parsedBody.data.comment ?? null },
    clientVisible: true
  });
  return res.status(201).json({ data: result.review });
});
