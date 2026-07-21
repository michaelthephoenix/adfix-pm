import { Router, type Response } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth, requireStaff } from "../middleware/auth.js";
import { insertActivityLog } from "../services/activity-log.service.js";
import {
  addDeliverableVersion,
  createDeliverable,
  createDeliverableMessage,
  forwardDeliverableFeedback,
  getDeliverableProjectId,
  listClientReviewerIds,
  listDeliverableContributorIds,
  listProjectDeliverables,
  listProjectSupervisorIds,
  reviewDeliverableVersionInternally,
  submitDeliverableVersionToClient,
  withdrawDeliverableVersionFromClient
} from "../services/deliverables.service.js";
import {
  createNotificationsForUsers,
  resolveActionNotificationsForVersion,
  resolveTaskActionNotifications,
  supersedeActionNotificationsForDeliverable
} from "../services/notifications.service.js";
import { hasProjectPermission } from "../services/rbac.service.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { sendConflict, sendError, sendForbidden, sendNotFound, sendUnauthorized } from "../utils/http-error.js";
import { sendValidationError } from "../utils/validation.js";

export const deliverablesRouter = Router();
deliverablesRouter.use(requireAuth, requireStaff);

const createSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(4000).optional().nullable(),
  taskIds: z.array(z.string().uuid()).max(50).optional().default([])
});
const projectSchema = z.object({ projectId: z.string().uuid() });
const idSchema = z.object({ id: z.string().uuid() });
const versionIdSchema = z.object({ versionId: z.string().uuid() });
const versionSchema = z.object({
  fileId: z.string().uuid(),
  submissionNote: z.string().trim().max(4000).optional().nullable()
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
const forwardSchema = z.object({
  sourceReviewId: z.string().uuid().optional().nullable(),
  taskIds: z.array(z.string().uuid()).min(1).max(50),
  body: z.string().trim().min(1).max(5000)
});
const idempotencyKeySchema = z.string().trim().min(1).max(255).optional();

function parseIdempotencyKey(req: AuthenticatedRequest, res: Response) {
  const parsed = idempotencyKeySchema.safeParse(req.get("idempotency-key"));
  if (!parsed.success) {
    sendValidationError(res, "Invalid idempotency key", parsed.error);
    return { ok: false as const };
  }
  return { ok: true as const, value: parsed.data ?? null };
}

function sendIdempotencyFailure(
  res: Response,
  reason: string
) {
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

async function requireSupervisor(projectId: string, userId: string) {
  return hasProjectPermission({ projectId, userId, permission: "deliverable:supervise" });
}

deliverablesRouter.get("/project/:projectId", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  const parsed = projectSchema.safeParse(req.params);
  if (!parsed.success) return sendValidationError(res, "Invalid project id", parsed.error);
  const allowed = await hasProjectPermission({ projectId: parsed.data.projectId, userId: req.user.id, permission: "project:view" });
  if (!allowed) return sendForbidden(res, "Forbidden");
  const canSupervise = await requireSupervisor(parsed.data.projectId, req.user.id);
  return res.status(200).json({
    data: await listProjectDeliverables(parsed.data.projectId, { includeClientFeedback: canSupervise }),
    meta: { canSupervise }
  });
});

deliverablesRouter.post("/", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, "Invalid deliverable payload", parsed.error);
  const allowed = await hasProjectPermission({ projectId: parsed.data.projectId, userId: req.user.id, permission: "file:write" });
  if (!allowed) return sendForbidden(res, "Forbidden");
  const result = await createDeliverable({ ...parsed.data, userId: req.user.id });
  if (!result.ok) return sendConflict(res, "Every linked task must belong to this project");
  await insertActivityLog({
    userId: req.user.id,
    projectId: parsed.data.projectId,
    action: "deliverable_created",
    details: { deliverableId: result.deliverable.id, title: result.deliverable.title, taskIds: parsed.data.taskIds }
  });
  return res.status(201).json({ data: result.deliverable });
});

deliverablesRouter.post("/:id/versions", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  const parsedId = idSchema.safeParse(req.params);
  const parsedBody = versionSchema.safeParse(req.body);
  if (!parsedId.success) return sendValidationError(res, "Invalid deliverable id", parsedId.error);
  if (!parsedBody.success) return sendValidationError(res, "Invalid version payload", parsedBody.error);
  const idempotency = parseIdempotencyKey(req, res);
  if (!idempotency.ok) return;

  const projectId = await getDeliverableProjectId(parsedId.data.id);
  if (!projectId) return sendNotFound(res, "Deliverable not found");
  const allowed = await hasProjectPermission({ projectId, userId: req.user.id, permission: "file:write" });
  if (!allowed) return sendForbidden(res, "Forbidden");

  const result = await addDeliverableVersion({
    deliverableId: parsedId.data.id,
    ...parsedBody.data,
    userId: req.user.id,
    idempotencyKey: idempotency.value
  });
  if (!result.ok) {
    const idempotencyResponse = sendIdempotencyFailure(res, result.reason);
    if (idempotencyResponse) return idempotencyResponse;
    if (result.reason === "delivery_locked") return sendConflict(res, "Deliverables are locked after Delivery");
    if (result.reason === "feedback_routing_required") return sendConflict(res, "A project supervisor must route the client feedback to your task before a revision can be submitted");
    if (result.reason === "review_active") return sendConflict(res, "This version is still in review. A supervisor must complete or withdraw the review before a new version can be added");
    return sendNotFound(res, result.reason === "file_not_found" ? "File not found" : "Deliverable not found");
  }
  await supersedeActionNotificationsForDeliverable(result.deliverable.id, result.version.id);
  const [supervisorIds, contributorIds] = await Promise.all([
    listProjectSupervisorIds(result.deliverable.project_id),
    listDeliverableContributorIds(result.deliverable.id)
  ]);
  await createNotificationsForUsers(supervisorIds, {
    projectId: result.deliverable.project_id,
    type: "deliverable_internal_review_requested",
    title: "Internal approval requested",
    message: `${req.user?.name} submitted ${result.deliverable.title} for internal approval.`,
    metadata: {
      deliverableId: result.deliverable.id,
      versionId: result.version.id,
      href: `/projects/${result.deliverable.project_id}?tab=deliverables`
    }
  }, {
    excludeUserIds: [req.user.id],
    eventKey: `deliverable:${result.version.id}:internal-review-requested`
  });
  await createNotificationsForUsers(contributorIds, {
    projectId: result.deliverable.project_id,
    type: "deliverable_internal_review_started",
    title: "Deliverable sent for internal review",
    message: `${req.user.name} submitted ${result.deliverable.title} to the project supervisors.`,
    metadata: {
      deliverableId: result.deliverable.id,
      versionId: result.version.id,
      href: `/projects/${result.deliverable.project_id}?tab=deliverables`
    }
  }, {
    excludeUserIds: [req.user.id, ...supervisorIds],
    eventKey: `deliverable:${result.version.id}:internal-review-started`
  });
  await insertActivityLog({
    userId: req.user.id,
    projectId: result.deliverable.project_id,
    action: "deliverable_internal_review_requested",
    details: { deliverableId: result.deliverable.id, versionId: result.version.id, versionNumber: result.version.version_number }
  });
  await Promise.all(result.completedTasks.map(async (task) => {
    await insertActivityLog({
      userId: req.user!.id,
      projectId: result.deliverable.project_id,
      action: "task_completed_by_deliverable",
      details: {
        taskId: task.id,
        deliverableId: result.deliverable.id,
        versionId: result.version.id
      }
    });
    await resolveTaskActionNotifications(task.id, "task_completed_by_deliverable");
  }));
  return res.status(201).json({ data: result.version });
});

deliverablesRouter.post("/versions/:versionId/internal-review", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  const parsedId = versionIdSchema.safeParse(req.params);
  const parsedBody = reviewSchema.safeParse(req.body);
  if (!parsedId.success) return sendValidationError(res, "Invalid version id", parsedId.error);
  if (!parsedBody.success) return sendValidationError(res, "Invalid internal review", parsedBody.error);
  const idempotency = parseIdempotencyKey(req, res);
  if (!idempotency.ok) return;

  const context = await pool.query<{ project_id: string }>(
    `SELECT d.project_id FROM deliverable_versions dv
     INNER JOIN deliverables d ON d.id = dv.deliverable_id AND d.deleted_at IS NULL
     WHERE dv.id = $1`,
    [parsedId.data.versionId]
  );
  const projectId = context.rows[0]?.project_id;
  if (!projectId) return sendNotFound(res, "Deliverable version not found");
  if (!(await requireSupervisor(projectId, req.user.id))) return sendForbidden(res, "Only project owners and managers can approve deliverables");

  const result = await reviewDeliverableVersionInternally({
    versionId: parsedId.data.versionId,
    reviewerId: req.user.id,
    ...parsedBody.data,
    idempotencyKey: idempotency.value
  });
  if (!result.ok) {
    const idempotencyResponse = sendIdempotencyFailure(res, result.reason);
    if (idempotencyResponse) return idempotencyResponse;
    if (result.reason === "delivery_locked") return sendConflict(res, "Deliverables are locked after Delivery");
    if (result.reason === "not_latest") return sendConflict(res, "Only the latest version can be reviewed");
    if (result.reason === "review_closed") return sendConflict(res, "This internal review is already complete");
    return sendNotFound(res, "Deliverable version not found");
  }

  await resolveActionNotificationsForVersion(
    parsedId.data.versionId,
    ["deliverable_internal_review_requested"],
    `internal_${parsedBody.data.decision}`
  );

  const [contributorIds, supervisorIds] = await Promise.all([
    listDeliverableContributorIds(result.access.deliverable_id),
    listProjectSupervisorIds(result.access.project_id)
  ]);
  await createNotificationsForUsers([
    result.access.submitted_by,
    ...contributorIds,
    ...supervisorIds
  ], {
    projectId: result.access.project_id,
    type: `deliverable_internal_${parsedBody.data.decision}`,
    title: parsedBody.data.decision === "approved" ? "Deliverable internally approved" : "Internal changes requested",
    message: parsedBody.data.decision === "approved"
      ? `${result.access.title} passed internal approval and is ready for client submission.`
      : `${req.user?.name} requested changes to ${result.access.title}.`,
    metadata: {
      deliverableId: result.access.deliverable_id,
      versionId: parsedId.data.versionId,
      href: `/projects/${result.access.project_id}?tab=deliverables`
    }
  }, {
    excludeUserIds: [req.user.id],
    eventKey: `deliverable:${parsedId.data.versionId}:internal-${parsedBody.data.decision}`
  });
  if (parsedBody.data.decision === "approved") {
    await createNotificationsForUsers([req.user.id], {
      projectId: result.access.project_id,
      type: "deliverable_client_submission_ready",
      title: "Ready to submit to the client",
      message: `${result.access.title} passed your internal approval. Submit it when it is ready for client review.`,
      metadata: {
        deliverableId: result.access.deliverable_id,
        versionId: parsedId.data.versionId,
        href: `/projects/${result.access.project_id}?tab=deliverables`
      },
      actionRequired: true
    }, {
      eventKey: `deliverable:${parsedId.data.versionId}:client-submission-ready:${req.user.id}`
    });
  }
  await insertActivityLog({
    userId: req.user.id,
    projectId: result.access.project_id,
    action: `deliverable_internal_${parsedBody.data.decision}`,
    details: {
      deliverableId: result.access.deliverable_id,
      versionId: parsedId.data.versionId,
      comment: parsedBody.data.comment ?? null
    }
  });
  return res.status(201).json({ data: result.review });
});

deliverablesRouter.post("/versions/:versionId/submit-client", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  const parsedId = versionIdSchema.safeParse(req.params);
  if (!parsedId.success) return sendValidationError(res, "Invalid version id", parsedId.error);
  const idempotency = parseIdempotencyKey(req, res);
  if (!idempotency.ok) return;
  const context = await pool.query<{ project_id: string }>(
    `SELECT d.project_id FROM deliverable_versions dv
     INNER JOIN deliverables d ON d.id = dv.deliverable_id AND d.deleted_at IS NULL WHERE dv.id = $1`,
    [parsedId.data.versionId]
  );
  const projectId = context.rows[0]?.project_id;
  if (!projectId) return sendNotFound(res, "Deliverable version not found");
  if (!(await requireSupervisor(projectId, req.user.id))) return sendForbidden(res, "Only project owners and managers can submit work to clients");

  const result = await submitDeliverableVersionToClient({
    versionId: parsedId.data.versionId,
    submittedBy: req.user.id,
    idempotencyKey: idempotency.value
  });
  if (!result.ok) {
    const idempotencyResponse = sendIdempotencyFailure(res, result.reason);
    if (idempotencyResponse) return idempotencyResponse;
    if (result.reason === "delivery_locked") return sendConflict(res, "Deliverables are locked after Delivery");
    if (result.reason === "not_latest") return sendConflict(res, "Only the latest version can be submitted");
    if (result.reason === "internal_approval_required") return sendConflict(res, "Internal approval is required before client submission");
    return sendNotFound(res, "Deliverable version not found");
  }
  await resolveActionNotificationsForVersion(
    parsedId.data.versionId,
    ["deliverable_client_submission_ready"],
    "submitted_to_client"
  );
  const [reviewerIds, supervisorIds, contributorIds] = await Promise.all([
    listClientReviewerIds(result.access.client_id),
    listProjectSupervisorIds(result.access.project_id),
    listDeliverableContributorIds(result.access.deliverable_id)
  ]);
  await createNotificationsForUsers(reviewerIds, {
    projectId: result.access.project_id,
    type: "deliverable_client_review_requested",
    title: "Deliverable ready for your review",
    message: `${result.access.title} is ready for client review.`,
    metadata: {
      deliverableId: result.access.deliverable_id,
      versionId: parsedId.data.versionId,
      href: `/portal/projects/${result.access.project_id}`
    }
  }, {
    excludeUserIds: [req.user.id],
    eventKey: `deliverable:${parsedId.data.versionId}:client-review-requested`
  });
  await createNotificationsForUsers([...supervisorIds, ...contributorIds], {
    projectId: result.access.project_id,
    type: "deliverable_client_review_started",
    title: "Deliverable sent to the client",
    message: `${req.user.name} submitted ${result.access.title} for client review.`,
    metadata: {
      deliverableId: result.access.deliverable_id,
      versionId: parsedId.data.versionId,
      href: `/projects/${result.access.project_id}?tab=deliverables`
    }
  }, {
    excludeUserIds: [req.user.id],
    eventKey: `deliverable:${parsedId.data.versionId}:client-review-started`
  });
  await insertActivityLog({
    userId: req.user.id,
    projectId: result.access.project_id,
    action: "deliverable_submitted_to_client",
    details: { deliverableId: result.access.deliverable_id, versionId: parsedId.data.versionId },
    clientVisible: true
  });
  return res.status(200).json({ data: { submitted: true } });
});

deliverablesRouter.post("/versions/:versionId/withdraw-client", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  const parsedId = versionIdSchema.safeParse(req.params);
  if (!parsedId.success) return sendValidationError(res, "Invalid version id", parsedId.error);
  const idempotency = parseIdempotencyKey(req, res);
  if (!idempotency.ok) return;
  const context = await pool.query<{ project_id: string }>(
    `SELECT d.project_id FROM deliverable_versions dv
     INNER JOIN deliverables d ON d.id = dv.deliverable_id AND d.deleted_at IS NULL WHERE dv.id = $1`,
    [parsedId.data.versionId]
  );
  const projectId = context.rows[0]?.project_id;
  if (!projectId) return sendNotFound(res, "Deliverable version not found");
  if (!(await requireSupervisor(projectId, req.user.id))) return sendForbidden(res, "Only project owners and managers can pull work back from clients");

  const result = await withdrawDeliverableVersionFromClient({
    versionId: parsedId.data.versionId,
    withdrawnBy: req.user.id,
    idempotencyKey: idempotency.value
  });
  if (!result.ok) {
    const idempotencyResponse = sendIdempotencyFailure(res, result.reason);
    if (idempotencyResponse) return idempotencyResponse;
    if (result.reason === "not_submitter") return sendForbidden(res, "Only the supervisor who submitted this version can pull it back");
    if (result.reason === "delivery_locked") return sendConflict(res, "Deliverables are locked after Delivery");
    if (result.reason === "not_latest") return sendConflict(res, "Only the latest version can be pulled back");
    if (result.reason === "review_closed") return sendConflict(res, "Only a version awaiting client review can be pulled back");
    return sendNotFound(res, "Deliverable version not found");
  }

  const [reviewerIds, supervisorIds, contributorIds] = await Promise.all([
    listClientReviewerIds(result.access.client_id),
    listProjectSupervisorIds(result.access.project_id),
    listDeliverableContributorIds(result.access.deliverable_id)
  ]);
  await resolveActionNotificationsForVersion(
    parsedId.data.versionId,
    ["deliverable_client_review_requested"],
    "withdrawn_from_client",
    "superseded"
  );
  await createNotificationsForUsers(reviewerIds, {
    projectId: result.access.project_id,
    type: "deliverable_client_review_withdrawn",
    title: "Deliverable temporarily withdrawn",
    message: `${result.access.title} was pulled back by the project team and is no longer available for review.`,
    metadata: {
      deliverableId: result.access.deliverable_id,
      versionId: parsedId.data.versionId,
      href: `/portal/projects/${result.access.project_id}`
    }
  }, {
    excludeUserIds: [req.user.id],
    eventKey: `deliverable:${parsedId.data.versionId}:client-review-withdrawn`
  });
  await createNotificationsForUsers([...supervisorIds, ...contributorIds], {
    projectId: result.access.project_id,
    type: "deliverable_client_review_withdrawn_internal",
    title: "Deliverable pulled back from client review",
    message: `${req.user.name} pulled ${result.access.title} back for internal follow-up.`,
    metadata: {
      deliverableId: result.access.deliverable_id,
      versionId: parsedId.data.versionId,
      href: `/projects/${result.access.project_id}?tab=deliverables`
    }
  }, {
    excludeUserIds: [req.user.id],
    eventKey: `deliverable:${parsedId.data.versionId}:client-review-withdrawn-internal`
  });
  await insertActivityLog({
    userId: req.user.id,
    projectId: result.access.project_id,
    action: "deliverable_withdrawn_from_client",
    details: {
      deliverableId: result.access.deliverable_id,
      versionId: parsedId.data.versionId,
      previousStatus: "in_review",
      nextStatus: "internal_approved"
    },
    clientVisible: true
  });
  return res.status(200).json({ data: { withdrawn: true } });
});

deliverablesRouter.post("/versions/:versionId/messages", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  const parsedId = versionIdSchema.safeParse(req.params);
  const parsedBody = messageSchema.safeParse(req.body);
  if (!parsedId.success) return sendValidationError(res, "Invalid version id", parsedId.error);
  if (!parsedBody.success) return sendValidationError(res, "Invalid message", parsedBody.error);
  const idempotency = parseIdempotencyKey(req, res);
  if (!idempotency.ok) return;
  const context = await pool.query<{ project_id: string }>(
    `SELECT d.project_id FROM deliverable_versions dv
     INNER JOIN deliverables d ON d.id = dv.deliverable_id AND d.deleted_at IS NULL WHERE dv.id = $1`,
    [parsedId.data.versionId]
  );
  const projectId = context.rows[0]?.project_id;
  if (!projectId) return sendNotFound(res, "Deliverable version not found");
  if (!(await requireSupervisor(projectId, req.user.id))) return sendForbidden(res, "Only project owners and managers can reply to clients");

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
  await resolveActionNotificationsForVersion(
    parsedId.data.versionId,
    ["deliverable_changes_requested", "deliverable_client_message"],
    "staff_replied"
  );
  const reviewerIds = await listClientReviewerIds(result.context.client_id);
  await createNotificationsForUsers(reviewerIds, {
    projectId: result.context.project_id,
    type: "deliverable_staff_reply",
    title: "New reply from the project team",
    message: `${req.user?.name} replied about ${result.context.title}.`,
    metadata: { versionId: parsedId.data.versionId, href: `/portal/projects/${result.context.project_id}` }
  }, {
    excludeUserIds: [req.user.id],
    eventKey: `deliverable-message:${result.message.id}:staff-reply`
  });
  await insertActivityLog({
    userId: req.user.id,
    projectId: result.context.project_id,
    action: "deliverable_staff_reply",
    details: { deliverableId: result.context.deliverable_id, versionId: parsedId.data.versionId },
    clientVisible: true
  });
  return res.status(201).json({ data: result.message });
});

deliverablesRouter.post("/versions/:versionId/forward-feedback", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  const parsedId = versionIdSchema.safeParse(req.params);
  const parsedBody = forwardSchema.safeParse(req.body);
  if (!parsedId.success) return sendValidationError(res, "Invalid version id", parsedId.error);
  if (!parsedBody.success) return sendValidationError(res, "Invalid feedback routing payload", parsedBody.error);
  const idempotency = parseIdempotencyKey(req, res);
  if (!idempotency.ok) return;
  const context = await pool.query<{ project_id: string }>(
    `SELECT d.project_id FROM deliverable_versions dv
     INNER JOIN deliverables d ON d.id = dv.deliverable_id AND d.deleted_at IS NULL WHERE dv.id = $1`,
    [parsedId.data.versionId]
  );
  const projectId = context.rows[0]?.project_id;
  if (!projectId) return sendNotFound(res, "Deliverable version not found");
  if (!(await requireSupervisor(projectId, req.user.id))) return sendForbidden(res, "Only project owners and managers can route client feedback");

  const result = await forwardDeliverableFeedback({
    versionId: parsedId.data.versionId,
    sourceReviewId: parsedBody.data.sourceReviewId,
    taskIds: parsedBody.data.taskIds,
    forwardedBy: req.user.id,
    body: parsedBody.data.body,
    idempotencyKey: idempotency.value
  });
  if (!result.ok) {
    const idempotencyResponse = sendIdempotencyFailure(res, result.reason);
    if (idempotencyResponse) return idempotencyResponse;
    if (result.reason === "delivery_locked") return sendConflict(res, "Feedback routing is closed after Delivery");
    if (result.reason === "not_latest") return sendConflict(res, "Feedback can only be routed from the latest deliverable version");
    if (result.reason === "review_closed") return sendConflict(res, "This client review no longer has feedback awaiting action");
    if (result.reason === "invalid_tasks") return sendConflict(res, "Every selected task must belong to this project");
    if (result.reason === "invalid_review") return sendConflict(res, "The selected client review does not belong to this version");
    return sendNotFound(res, "Deliverable version not found");
  }
  await resolveActionNotificationsForVersion(
    parsedId.data.versionId,
    ["deliverable_changes_requested", "deliverable_client_message"],
    "feedback_forwarded"
  );
  const recipientByUser = new Map(result.recipients.map((recipient) => [recipient.user_id, recipient.task_id]));
  recipientByUser.delete(req.user.id);
  await Promise.all([...recipientByUser].map(([userId, taskId]) => createNotificationsForUsers([userId], {
    projectId: result.context.project_id,
    taskId,
    type: "client_feedback_forwarded",
    title: "Client feedback assigned",
    message: `${req.user?.name} routed feedback from ${result.context.title} to your task.`,
    metadata: {
      deliverableId: result.context.deliverable_id,
      versionId: parsedId.data.versionId,
      taskId,
      href: `/projects/${result.context.project_id}?tab=tasks&task=${taskId}`
    }
  }, {
    eventKey: `deliverable:${parsedId.data.versionId}:feedback-forward:${parsedBody.data.sourceReviewId ?? "general"}:${taskId}:${userId}`
  })));
  await insertActivityLog({
    userId: req.user.id,
    projectId: result.context.project_id,
    action: "deliverable_feedback_forwarded",
    details: {
      deliverableId: result.context.deliverable_id,
      versionId: parsedId.data.versionId,
      sourceReviewId: parsedBody.data.sourceReviewId ?? null,
      taskIds: parsedBody.data.taskIds
    }
  });
  return res.status(201).json({ data: { forwardedTaskIds: result.tasks.map((task) => task.id), recipientCount: recipientByUser.size } });
});
