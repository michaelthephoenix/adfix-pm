import { Router, type Response } from "express";
import { z } from "zod";
import { requireAuth, requireClient } from "../middleware/auth.js";
import {
  getClientPortalProject,
  getClientVersionAccessRole,
  listClientPortalProjects,
  listClientReviewInbox
} from "../services/client-portal.service.js";
import {
  createDeliverableMessage,
  listClientReviewerIds,
  listDeliverableContributorIds,
  listProjectSupervisorIds,
  reviewDeliverableVersion
} from "../services/deliverables.service.js";
import {
  createNotificationsForUsers,
  resolveActionNotificationsForVersion
} from "../services/notifications.service.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { sendConflict, sendError, sendForbidden, sendNotFound, sendUnauthorized } from "../utils/http-error.js";
import { sendValidationError } from "../utils/validation.js";
import { insertActivityLog } from "../services/activity-log.service.js";

export const clientPortalRouter = Router();
clientPortalRouter.use(requireAuth, requireClient);

const projectSchema = z.object({ projectId: z.string().uuid() });
const versionSchema = z.object({ versionId: z.string().uuid() });
const reviewInboxQuerySchema = z.object({
  status: z.enum(["pending", "reviewed", "history"]).optional().default("pending"),
  sort: z.enum(["oldest", "newest", "deadline"]).optional()
});
const reviewSchema = z.object({
  decision: z.enum(["approved", "changes_requested"]),
  comment: z.string().trim().max(4000).optional().nullable()
}).superRefine((value, context) => {
  if (value.decision === "changes_requested" && !value.comment) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["comment"], message: "A comment is required" });
  }
});
const messageSchema = z.object({ body: z.string().trim().min(1).max(4000) });
const idempotencyKeySchema = z.string().trim().min(1).max(255).optional();

function parseIdempotencyKey(req: AuthenticatedRequest, res: Response) {
  const parsed = idempotencyKeySchema.safeParse(req.get("idempotency-key"));
  if (!parsed.success) {
    sendValidationError(res, "Invalid idempotency key", parsed.error);
    return { ok: false as const };
  }
  return { ok: true as const, value: parsed.data ?? null };
}

function sendIdempotencyFailure(res: Response, reason: string) {
  if (reason === "idempotency_conflict") {
    return sendError(
      res,
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "This action key was already used for a different request. Please try the action again."
    );
  }
  if (reason === "idempotency_in_progress") {
    return sendError(
      res,
      409,
      "IDEMPOTENCY_IN_PROGRESS",
      "This action is still being processed. Please wait a moment and refresh."
    );
  }
  return null;
}

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
  const idempotency = parseIdempotencyKey(req, res);
  if (!idempotency.ok) return;
  const accessRole = await getClientVersionAccessRole(req.user.id, parsedId.data.versionId);
  if (!accessRole) return sendNotFound(res, "Deliverable version not found");
  if (accessRole === "viewer") return sendForbidden(res, "Viewer access is read-only");
  const result = await reviewDeliverableVersion({
    versionId: parsedId.data.versionId,
    reviewerId: req.user.id,
    ...parsedBody.data,
    idempotencyKey: idempotency.value
  });
  if (!result.ok) {
    const idempotencyResponse = sendIdempotencyFailure(res, result.reason);
    if (idempotencyResponse) return idempotencyResponse;
    if (result.reason === "delivery_locked") return sendConflict(res, "Reviews are closed after Delivery");
    if (result.reason === "not_latest") return sendConflict(res, "Only the latest version can be reviewed");
    if (result.reason === "review_closed") return sendConflict(res, "This review has already been completed");
    return sendNotFound(res, "Deliverable version not found");
  }

  await resolveActionNotificationsForVersion(
    parsedId.data.versionId,
    ["deliverable_client_review_requested"],
    `client_${parsedBody.data.decision}`
  );

  const [supervisorIds, contributorIds, clientReviewerIds] = await Promise.all([
    listProjectSupervisorIds(result.access.project_id),
    listDeliverableContributorIds(result.access.deliverable_id),
    listClientReviewerIds(result.access.client_id)
  ]);
  await createNotificationsForUsers(supervisorIds, {
    projectId: result.access.project_id,
    type: `deliverable_${parsedBody.data.decision}`,
    title: parsedBody.data.decision === "approved" ? "Deliverable approved" : "Changes requested",
    message: parsedBody.data.decision === "approved"
      ? `${req.user.name} approved ${result.access.title}.`
      : `${req.user.name} requested changes to ${result.access.title}. Review the feedback and decide the next step.`,
    metadata: {
      deliverableId: result.access.deliverable_id,
      versionId: parsedId.data.versionId,
      decision: parsedBody.data.decision,
      href: `/projects/${result.access.project_id}?tab=deliverables`
    }
  }, {
    excludeUserIds: [req.user.id],
    eventKey: `deliverable-review:${result.review.id}:supervisors`
  });
  await createNotificationsForUsers(contributorIds, {
    projectId: result.access.project_id,
    type: parsedBody.data.decision === "approved"
      ? "deliverable_client_approved"
      : "deliverable_client_feedback_received",
    title: parsedBody.data.decision === "approved"
      ? "Client approved the deliverable"
      : "Client feedback is with the supervisor",
    message: parsedBody.data.decision === "approved"
      ? `${result.access.title} was approved by the client.`
      : `The client reviewed ${result.access.title}. A project supervisor is deciding the next step.`,
    metadata: {
      deliverableId: result.access.deliverable_id,
      versionId: parsedId.data.versionId,
      decision: parsedBody.data.decision,
      href: `/projects/${result.access.project_id}?tab=deliverables`
    }
  }, {
    excludeUserIds: [req.user.id, ...supervisorIds],
    eventKey: `deliverable-review:${result.review.id}:contributors`
  });
  await createNotificationsForUsers(clientReviewerIds, {
    projectId: result.access.project_id,
    type: "deliverable_client_review_completed",
    title: "Client review completed",
    message: parsedBody.data.decision === "approved"
      ? `${req.user.name} approved ${result.access.title}.`
      : `${req.user.name} requested changes to ${result.access.title}.`,
    metadata: {
      deliverableId: result.access.deliverable_id,
      versionId: parsedId.data.versionId,
      decision: parsedBody.data.decision,
      href: `/portal/projects/${result.access.project_id}`
    }
  }, {
    excludeUserIds: [req.user.id],
    eventKey: `deliverable-review:${result.review.id}:client-reviewers`
  });
  await insertActivityLog({
    userId: req.user.id,
    projectId: result.access.project_id,
    action: `deliverable_${parsedBody.data.decision}`,
    details: { versionId: parsedId.data.versionId, deliverableId: result.access.deliverable_id, comment: parsedBody.data.comment ?? null },
    clientVisible: true
  });
  return res.status(201).json({ data: result.review });
});

clientPortalRouter.get("/reviews", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  const parsed = reviewInboxQuerySchema.safeParse(req.query);
  if (!parsed.success) return sendValidationError(res, "Invalid review inbox query", parsed.error);
  const sort = parsed.data.sort ?? (parsed.data.status === "pending" ? "oldest" : "newest");
  const result = await listClientReviewInbox(req.user.id, parsed.data.status, sort);
  return res.status(200).json({
    data: result.rows,
    meta: { status: parsed.data.status, sort, counts: result.counts }
  });
});

clientPortalRouter.post("/versions/:versionId/messages", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  const parsedId = versionSchema.safeParse(req.params);
  const parsedBody = messageSchema.safeParse(req.body);
  if (!parsedId.success) return sendValidationError(res, "Invalid version id", parsedId.error);
  if (!parsedBody.success) return sendValidationError(res, "Invalid message", parsedBody.error);
  const idempotency = parseIdempotencyKey(req, res);
  if (!idempotency.ok) return;
  const accessRole = await getClientVersionAccessRole(req.user.id, parsedId.data.versionId);
  if (!accessRole) return sendNotFound(res, "Deliverable version not found");
  if (accessRole === "viewer") return sendForbidden(res, "Viewer access is read-only");

  const result = await createDeliverableMessage({
    versionId: parsedId.data.versionId,
    authorId: req.user.id,
    body: parsedBody.data.body,
    idempotencyKey: idempotency.value
  });
  if (!result.ok) {
    const idempotencyResponse = sendIdempotencyFailure(res, result.reason);
    if (idempotencyResponse) return idempotencyResponse;
    return result.reason === "delivery_locked"
      ? sendConflict(res, "Discussion is closed after Delivery")
      : sendNotFound(res, "Deliverable version not found");
  }
  const supervisorIds = await listProjectSupervisorIds(result.context.project_id);
  await createNotificationsForUsers(supervisorIds, {
    projectId: result.context.project_id,
    type: "deliverable_client_message",
    title: "New client message",
    message: `${req.user?.name} replied about ${result.context.title}.`,
    metadata: {
      deliverableId: result.context.deliverable_id,
      versionId: parsedId.data.versionId,
      href: `/projects/${result.context.project_id}?tab=deliverables`
    }
  }, {
    excludeUserIds: [req.user.id],
    eventKey: `deliverable-message:${result.message.id}:client-message`
  });
  await insertActivityLog({
    userId: req.user.id,
    projectId: result.context.project_id,
    action: "deliverable_client_message",
    details: { deliverableId: result.context.deliverable_id, versionId: parsedId.data.versionId },
    clientVisible: true
  });
  return res.status(201).json({ data: result.message });
});
