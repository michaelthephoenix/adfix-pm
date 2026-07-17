import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireStaff } from "../middleware/auth.js";
import {
  addDeliverableVersion,
  createDeliverable,
  getDeliverableProjectId,
  listClientReviewerIds,
  listProjectDeliverables
} from "../services/deliverables.service.js";
import { createNotification } from "../services/notifications.service.js";
import { getProjectById } from "../services/projects.service.js";
import { hasProjectPermission } from "../services/rbac.service.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { sendForbidden, sendNotFound, sendUnauthorized } from "../utils/http-error.js";
import { sendValidationError } from "../utils/validation.js";
import { insertActivityLog } from "../services/activity-log.service.js";

export const deliverablesRouter = Router();
deliverablesRouter.use(requireAuth, requireStaff);

const createSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(4000).optional().nullable()
});
const projectSchema = z.object({ projectId: z.string().uuid() });
const idSchema = z.object({ id: z.string().uuid() });
const versionSchema = z.object({
  fileId: z.string().uuid(),
  submissionNote: z.string().trim().max(4000).optional().nullable()
});

deliverablesRouter.get("/project/:projectId", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  const parsed = projectSchema.safeParse(req.params);
  if (!parsed.success) return sendValidationError(res, "Invalid project id", parsed.error);
  const allowed = await hasProjectPermission({ projectId: parsed.data.projectId, userId: req.user.id, permission: "project:view" });
  if (!allowed) return sendForbidden(res, "Forbidden");
  return res.status(200).json({ data: await listProjectDeliverables(parsed.data.projectId) });
});

deliverablesRouter.post("/", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, "Invalid deliverable payload", parsed.error);
  const allowed = await hasProjectPermission({ projectId: parsed.data.projectId, userId: req.user.id, permission: "file:write" });
  if (!allowed) return sendForbidden(res, "Forbidden");
  const deliverable = await createDeliverable({ ...parsed.data, userId: req.user.id });
  await insertActivityLog({ userId: req.user.id, projectId: parsed.data.projectId, action: "deliverable_created", details: { deliverableId: deliverable.id, title: deliverable.title }, clientVisible: true });
  return res.status(201).json({ data: deliverable });
});

deliverablesRouter.post("/:id/versions", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  const parsedId = idSchema.safeParse(req.params);
  const parsedBody = versionSchema.safeParse(req.body);
  if (!parsedId.success) return sendValidationError(res, "Invalid deliverable id", parsedId.error);
  if (!parsedBody.success) return sendValidationError(res, "Invalid version payload", parsedBody.error);

  const projectId = await getDeliverableProjectId(parsedId.data.id);
  if (!projectId) return sendNotFound(res, "Deliverable not found");
  const allowed = await hasProjectPermission({ projectId, userId: req.user.id, permission: "file:write" });
  if (!allowed) return sendForbidden(res, "Forbidden");

  const result = await addDeliverableVersion({ deliverableId: parsedId.data.id, ...parsedBody.data, userId: req.user.id });
  if (!result.ok) return sendNotFound(res, result.reason === "file_not_found" ? "File not found" : "Deliverable not found");
  const project = await getProjectById(result.deliverable.project_id);
  if (!project) return sendNotFound(res, "Project not found");
  const reviewerIds = await listClientReviewerIds(project.client_id);
  await Promise.all(reviewerIds.map((userId) => createNotification({
    userId,
    projectId: project.id,
    type: "deliverable_review_requested",
    title: "Deliverable ready for review",
    message: `${result.deliverable.title} has a new version ready for your review.`,
    metadata: { deliverableId: result.deliverable.id, versionId: result.version.id }
  })));
  await insertActivityLog({ userId: req.user.id, projectId: project.id, action: "deliverable_submitted", details: { deliverableId: result.deliverable.id, versionId: result.version.id, versionNumber: result.version.version_number }, clientVisible: true });
  return res.status(201).json({ data: result.version });
});
