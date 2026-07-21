import { pool } from "../db/pool.js";
import {
  claimWorkflowMutation,
  completeWorkflowMutation
} from "./workflow-mutation.service.js";

type DeliverableStatus =
  | "draft"
  | "internal_review"
  | "internal_changes_requested"
  | "internal_approved"
  | "in_review"
  | "changes_requested"
  | "approved";
export type ReviewDecision = "approved" | "changes_requested";

type DeliverableRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: DeliverableStatus;
  created_by: string;
  created_at: Date;
  updated_at: Date;
};

type VersionRow = {
  id: string;
  deliverable_id: string;
  file_id: string;
  version_number: number;
  submission_note: string | null;
  submitted_by: string;
  submitted_by_name: string;
  submitted_at: Date;
  client_submitted_by: string | null;
  client_submitted_by_name: string | null;
  client_submitted_at: Date | null;
  client_withdrawn_by: string | null;
  client_withdrawn_by_name: string | null;
  client_withdrawn_at: Date | null;
  file_name: string;
  mime_type: string;
  file_size: string;
  storage_type: "local" | "s3" | "google_drive" | "dropbox" | "onedrive" | "external";
  external_url: string | null;
};

type ReviewRow = {
  id: string;
  deliverable_version_id: string;
  reviewer_id: string;
  reviewer_name: string;
  decision: ReviewDecision;
  comment: string | null;
  created_at: Date;
};

type MessageRow = {
  id: string;
  deliverable_version_id: string;
  author_id: string;
  author_name: string;
  author_type: "staff" | "client";
  body: string;
  created_at: Date;
};

type DeliverableTaskRow = {
  deliverable_id: string;
  id: string;
  title: string;
  status: string;
};

type FeedbackForwardSummaryRow = {
  deliverable_version_id: string;
  forwarded_count: string;
};

type IdempotencyFailure = {
  ok: false;
  reason: "idempotency_conflict" | "idempotency_in_progress";
};

function idempotencyFailure(status: "conflict" | "in_progress"): IdempotencyFailure {
  return {
    ok: false,
    reason: status === "conflict" ? "idempotency_conflict" : "idempotency_in_progress"
  };
}

type VersionSubmissionContext = DeliverableRow & {
  project_name: string;
  current_phase: string;
  latest_client_withdrawn_at: Date | null;
};

type InternalReviewAccess = {
  deliverable_id: string;
  project_id: string;
  project_name: string;
  title: string;
  current_phase: string;
  status: DeliverableStatus;
  latest_version_id: string;
  submitted_by: string;
};

type ClientSubmissionAccess = {
  deliverable_id: string;
  project_id: string;
  project_name: string;
  title: string;
  current_phase: string;
  status: DeliverableStatus;
  client_id: string;
  latest_version_id: string;
};

type ClientWithdrawalAccess = ClientSubmissionAccess & {
  client_submitted_by: string | null;
  client_submitted_at: Date | null;
  client_withdrawn_at: Date | null;
};

type ClientReviewAccess = ClientSubmissionAccess;

type DeliverableMessageContext = {
  project_id: string;
  deliverable_id: string;
  title: string;
  current_phase: string;
  client_id: string;
};

type FeedbackForwardContext = {
  project_id: string;
  deliverable_id: string;
  title: string;
  status: DeliverableStatus;
  current_phase: string;
  latest_version_id: string;
};

type AddVersionSuccess = {
  ok: true;
  deliverable: VersionSubmissionContext;
  version: VersionRow;
  completedTasks: Array<{ id: string; title: string }>;
};

type InternalReviewSuccess = {
  ok: true;
  review: ReviewRow;
  access: InternalReviewAccess;
  nextStatus: "internal_approved" | "internal_changes_requested";
};

type ClientSubmissionSuccess = { ok: true; access: ClientSubmissionAccess };
type ClientWithdrawalSuccess = { ok: true; access: ClientWithdrawalAccess };
type ClientReviewSuccess = { ok: true; review: ReviewRow; access: ClientReviewAccess };
type DeliverableMessageSuccess = { ok: true; message: MessageRow; context: DeliverableMessageContext };
type FeedbackForwardSuccess = {
  ok: true;
  context: FeedbackForwardContext;
  tasks: Array<{ id: string; title: string; previous_status: string }>;
  recipients: Array<{ user_id: string; task_id: string }>;
};

export async function createDeliverable(input: {
  projectId: string;
  title: string;
  description?: string | null;
  taskIds?: string[];
  userId: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const taskIds = [...new Set(input.taskIds ?? [])];
    if (taskIds.length > 0) {
      const tasks = await client.query<{ id: string }>(
        `SELECT id FROM tasks
         WHERE project_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
        [input.projectId, taskIds]
      );
      if (tasks.rows.length !== taskIds.length) {
        await client.query("ROLLBACK");
        return { ok: false as const, reason: "invalid_tasks" as const };
      }
    }

    const result = await client.query<DeliverableRow>(
      `INSERT INTO deliverables (project_id, title, description, status, created_by)
       VALUES ($1, $2, $3, 'draft', $4)
       RETURNING id, project_id, title, description, status, created_by, created_at, updated_at`,
      [input.projectId, input.title, input.description ?? null, input.userId]
    );
    const deliverable = result.rows[0];
    if (taskIds.length > 0) {
      await client.query(
        `INSERT INTO deliverable_tasks (deliverable_id, task_id)
         SELECT $1, UNNEST($2::uuid[])`,
        [deliverable.id, taskIds]
      );
    }
    await client.query("COMMIT");
    return { ok: true as const, deliverable };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getDeliverableProjectId(deliverableId: string) {
  const result = await pool.query<{ project_id: string }>(
    "SELECT project_id FROM deliverables WHERE id = $1 AND deleted_at IS NULL",
    [deliverableId]
  );
  return result.rows[0]?.project_id ?? null;
}

export async function listProjectSupervisorIds(projectId: string) {
  const result = await pool.query<{ user_id: string }>(
    `SELECT created_by AS user_id FROM projects WHERE id = $1 AND deleted_at IS NULL
     UNION
     SELECT user_id FROM project_team WHERE project_id = $1 AND LOWER(role) = 'manager'`,
    [projectId]
  );
  return result.rows.map((row) => row.user_id);
}

export async function listDeliverableContributorIds(deliverableId: string) {
  const result = await pool.query<{ user_id: string }>(
    `SELECT created_by AS user_id
     FROM deliverables
     WHERE id = $1 AND deleted_at IS NULL
     UNION
     SELECT task_assignee.user_id
     FROM deliverable_tasks deliverable_task
     INNER JOIN task_assignees task_assignee ON task_assignee.task_id = deliverable_task.task_id
     WHERE deliverable_task.deliverable_id = $1
     UNION
     SELECT task.assigned_to AS user_id
     FROM deliverable_tasks deliverable_task
     INNER JOIN tasks task ON task.id = deliverable_task.task_id
     WHERE deliverable_task.deliverable_id = $1 AND task.assigned_to IS NOT NULL`,
    [deliverableId]
  );
  return result.rows.map((row) => row.user_id);
}

export async function listProjectDeliverables(
  projectId: string,
  options: { clientVisibleOnly?: boolean; includeClientFeedback?: boolean } = {}
) {
  const clientVisibleOnly = options.clientVisibleOnly === true;
  const includeClientFeedback = options.includeClientFeedback === true;
  const [deliverablesResult, versionsResult, reviewsResult, internalReviewsResult, messagesResult, tasksResult, forwardsResult] = await Promise.all([
    pool.query<DeliverableRow>(
      `SELECT id, project_id, title, description, status, created_by, created_at, updated_at
       FROM deliverables d
       WHERE project_id = $1 AND deleted_at IS NULL
         AND ($2::boolean = FALSE OR (
           d.status IN ('in_review', 'changes_requested', 'approved')
           AND EXISTS (
             SELECT 1 FROM deliverable_versions visible_version
             WHERE visible_version.deliverable_id = d.id
               AND visible_version.client_submitted_at IS NOT NULL
               AND visible_version.client_withdrawn_at IS NULL
           )
         ))
       ORDER BY created_at DESC`,
      [projectId, clientVisibleOnly]
    ),
    pool.query<VersionRow>(
      `SELECT
         dv.id, dv.deliverable_id, dv.file_id, dv.version_number, dv.submission_note,
         dv.submitted_by, submitter.name AS submitted_by_name, dv.submitted_at,
         dv.client_submitted_by, client_submitter.name AS client_submitted_by_name, dv.client_submitted_at,
         COALESCE(dv.client_withdrawn_by, withdrawal_history.actor_id) AS client_withdrawn_by,
         COALESCE(client_withdrawer.name, withdrawal_history.actor_name) AS client_withdrawn_by_name,
         COALESCE(dv.client_withdrawn_at, withdrawal_history.created_at) AS client_withdrawn_at,
         f.file_name, f.mime_type, f.file_size::text, f.storage_type, f.external_url
       FROM deliverable_versions dv
       INNER JOIN deliverables d ON d.id = dv.deliverable_id AND d.deleted_at IS NULL
       INNER JOIN files f ON f.id = dv.file_id AND f.deleted_at IS NULL
       INNER JOIN users submitter ON submitter.id = dv.submitted_by
       LEFT JOIN users client_submitter ON client_submitter.id = dv.client_submitted_by
       LEFT JOIN users client_withdrawer ON client_withdrawer.id = dv.client_withdrawn_by
       LEFT JOIN LATERAL (
         SELECT event.actor_id, actor.name AS actor_name, event.created_at
         FROM deliverable_client_events event
         INNER JOIN users actor ON actor.id = event.actor_id
         WHERE event.deliverable_version_id = dv.id
           AND event.event_type = 'withdrawn'
         ORDER BY event.created_at DESC
         LIMIT 1
       ) withdrawal_history ON TRUE
       WHERE d.project_id = $1
         AND ($2::boolean = FALSE OR (
           dv.client_submitted_at IS NOT NULL AND dv.client_withdrawn_at IS NULL
         ))
       ORDER BY dv.version_number DESC`,
      [projectId, clientVisibleOnly]
    ),
    pool.query<ReviewRow>(
      `SELECT
         dr.id, dr.deliverable_version_id, dr.reviewer_id, u.name AS reviewer_name,
         dr.decision, dr.comment, dr.created_at
       FROM deliverable_reviews dr
       INNER JOIN deliverable_versions dv ON dv.id = dr.deliverable_version_id
       INNER JOIN deliverables d ON d.id = dv.deliverable_id AND d.deleted_at IS NULL
       INNER JOIN users u ON u.id = dr.reviewer_id
       WHERE d.project_id = $1 AND $2::boolean = TRUE
       ORDER BY dr.created_at DESC`,
      [projectId, includeClientFeedback]
    ),
    pool.query<ReviewRow>(
      `SELECT
         review.id, review.deliverable_version_id, review.reviewer_id, u.name AS reviewer_name,
         review.decision, review.comment, review.created_at
       FROM deliverable_internal_reviews review
       INNER JOIN deliverable_versions dv ON dv.id = review.deliverable_version_id
       INNER JOIN deliverables d ON d.id = dv.deliverable_id AND d.deleted_at IS NULL
       INNER JOIN users u ON u.id = review.reviewer_id
       WHERE d.project_id = $1 AND $2::boolean = FALSE
       ORDER BY review.created_at DESC`,
      [projectId, clientVisibleOnly]
    ),
    pool.query<MessageRow>(
      `SELECT message.id, message.deliverable_version_id, message.author_id,
         u.name AS author_name, u.account_type AS author_type, message.body, message.created_at
       FROM deliverable_messages message
       INNER JOIN deliverable_versions dv ON dv.id = message.deliverable_version_id
       INNER JOIN deliverables d ON d.id = dv.deliverable_id AND d.deleted_at IS NULL
       INNER JOIN users u ON u.id = message.author_id
       WHERE d.project_id = $1 AND message.client_visible = TRUE AND $2::boolean = TRUE
       ORDER BY message.created_at ASC`,
      [projectId, includeClientFeedback]
    ),
    pool.query<DeliverableTaskRow>(
      `SELECT dt.deliverable_id, task.id, task.title, task.status
       FROM deliverable_tasks dt
       INNER JOIN tasks task ON task.id = dt.task_id AND task.deleted_at IS NULL
       INNER JOIN deliverables d ON d.id = dt.deliverable_id AND d.deleted_at IS NULL
       WHERE d.project_id = $1 AND $2::boolean = FALSE
       ORDER BY task.created_at ASC`,
      [projectId, clientVisibleOnly]
    ),
    pool.query<FeedbackForwardSummaryRow>(
      `SELECT forward.deliverable_version_id, COUNT(*)::text AS forwarded_count
       FROM deliverable_feedback_forwards forward
       INNER JOIN deliverable_versions dv ON dv.id = forward.deliverable_version_id
       INNER JOIN deliverables d ON d.id = dv.deliverable_id AND d.deleted_at IS NULL
       WHERE d.project_id = $1 AND $2::boolean = FALSE
       GROUP BY forward.deliverable_version_id`,
      [projectId, clientVisibleOnly]
    )
  ]);

  const groupByVersion = <T extends { deliverable_version_id: string }>(rows: T[]) => {
    const grouped = new Map<string, T[]>();
    for (const row of rows) grouped.set(row.deliverable_version_id, [...(grouped.get(row.deliverable_version_id) ?? []), row]);
    return grouped;
  };
  const reviewsByVersion = groupByVersion(reviewsResult.rows);
  const internalReviewsByVersion = groupByVersion(internalReviewsResult.rows);
  const messagesByVersion = groupByVersion(messagesResult.rows);
  const forwardsByVersion = new Map(forwardsResult.rows.map((row) => [row.deliverable_version_id, Number(row.forwarded_count)]));
  const tasksByDeliverable = new Map<string, DeliverableTaskRow[]>();
  for (const task of tasksResult.rows) tasksByDeliverable.set(task.deliverable_id, [...(tasksByDeliverable.get(task.deliverable_id) ?? []), task]);

  const versionsByDeliverable = new Map<string, Array<VersionRow & {
    reviews: ReviewRow[];
    internal_reviews: ReviewRow[];
    messages: MessageRow[];
    feedback_forward_count: number;
  }>>();
  for (const version of versionsResult.rows) {
    versionsByDeliverable.set(version.deliverable_id, [
      ...(versionsByDeliverable.get(version.deliverable_id) ?? []),
      {
        ...version,
        reviews: reviewsByVersion.get(version.id) ?? [],
        internal_reviews: internalReviewsByVersion.get(version.id) ?? [],
        messages: messagesByVersion.get(version.id) ?? [],
        feedback_forward_count: forwardsByVersion.get(version.id) ?? 0
      }
    ]);
  }

  return deliverablesResult.rows.map((deliverable) => ({
    ...deliverable,
    tasks: tasksByDeliverable.get(deliverable.id) ?? [],
    versions: versionsByDeliverable.get(deliverable.id) ?? []
  }));
}

export async function addDeliverableVersion(input: {
  deliverableId: string;
  fileId: string;
  submissionNote?: string | null;
  userId: string;
  idempotencyKey?: string | null;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const mutation = await claimWorkflowMutation<AddVersionSuccess>(client, {
      actorId: input.userId,
      operation: `deliverable-version-create:${input.deliverableId}`,
      idempotencyKey: input.idempotencyKey,
      payload: {
        deliverableId: input.deliverableId,
        fileId: input.fileId,
        submissionNote: input.submissionNote ?? null
      }
    });
    if (mutation?.status === "replay") {
      await client.query("COMMIT");
      return mutation.response;
    }
    if (mutation?.status === "conflict" || mutation?.status === "in_progress") {
      await client.query("ROLLBACK");
      return idempotencyFailure(mutation.status);
    }
    const mutationRecordId = mutation?.status === "acquired" ? mutation.recordId : undefined;

    const deliverableResult = await client.query<VersionSubmissionContext>(
      `SELECT d.id, d.project_id, d.title, d.description, d.status, d.created_by, d.created_at, d.updated_at,
         p.name AS project_name, p.current_phase,
         (SELECT client_withdrawn_at FROM deliverable_versions
          WHERE deliverable_id = d.id ORDER BY version_number DESC LIMIT 1) AS latest_client_withdrawn_at
       FROM deliverables d
       INNER JOIN projects p ON p.id = d.project_id AND p.deleted_at IS NULL
       WHERE d.id = $1 AND d.deleted_at IS NULL FOR UPDATE OF d`,
      [input.deliverableId]
    );
    const deliverable = deliverableResult.rows[0];
    if (!deliverable) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "deliverable_not_found" as const };
    }
    if (deliverable.current_phase === "delivery") {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "delivery_locked" as const };
    }
    const withdrawnForInternalFollowUp = deliverable.status === "internal_approved"
      && deliverable.latest_client_withdrawn_at !== null;
    if (!["draft", "internal_changes_requested", "changes_requested"].includes(deliverable.status)
      && !withdrawnForInternalFollowUp) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "review_active" as const };
    }
    if (deliverable.status === "changes_requested") {
      const routedAccess = await client.query<{ allowed: boolean }>(
        `SELECT (
           EXISTS (SELECT 1 FROM projects WHERE id = $1 AND created_by = $2)
           OR EXISTS (SELECT 1 FROM project_team WHERE project_id = $1 AND user_id = $2 AND LOWER(role) = 'manager')
           OR EXISTS (
             SELECT 1
             FROM deliverable_versions latest_version
             INNER JOIN deliverable_feedback_forwards forward ON forward.deliverable_version_id = latest_version.id
             INNER JOIN tasks task ON task.id = forward.task_id AND task.deleted_at IS NULL
             LEFT JOIN task_assignees assignee ON assignee.task_id = task.id AND assignee.user_id = $2
             WHERE latest_version.id = (
               SELECT id FROM deliverable_versions WHERE deliverable_id = $3 ORDER BY version_number DESC LIMIT 1
             ) AND (assignee.user_id IS NOT NULL OR task.assigned_to = $2)
           )
         ) AS allowed`,
        [deliverable.project_id, input.userId, deliverable.id]
      );
      if (!routedAccess.rows[0]?.allowed) {
        await client.query("ROLLBACK");
        return { ok: false as const, reason: "feedback_routing_required" as const };
      }
    }

    const fileResult = await client.query<{ id: string }>(
      `SELECT id FROM files WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
      [input.fileId, deliverable.project_id]
    );
    if (!fileResult.rows[0]) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "file_not_found" as const };
    }

    const versionResult = await client.query<VersionRow>(
      `INSERT INTO deliverable_versions (
         deliverable_id, file_id, version_number, submission_note, submitted_by
       )
       SELECT $1, $2, COALESCE(MAX(version_number), 0) + 1, $3, $4
       FROM deliverable_versions WHERE deliverable_id = $1
       RETURNING id, deliverable_id, file_id, version_number, submission_note,
         submitted_by, ''::text AS submitted_by_name, submitted_at,
         client_submitted_by, NULL::text AS client_submitted_by_name, client_submitted_at,
         client_withdrawn_by, NULL::text AS client_withdrawn_by_name, client_withdrawn_at,
         ''::text AS file_name, ''::text AS mime_type, '0'::text AS file_size`,
      [input.deliverableId, input.fileId, input.submissionNote ?? null, input.userId]
    );

    await client.query(`UPDATE deliverables SET status = 'internal_review', updated_at = NOW() WHERE id = $1`, [input.deliverableId]);
    const completedTasks = await client.query<{ id: string; title: string }>(
      `UPDATE tasks
       SET status = 'completed', completed_at = NOW(), updated_at = NOW()
       WHERE id IN (
         SELECT task_id FROM deliverable_tasks WHERE deliverable_id = $1
       )
         AND deleted_at IS NULL
         AND status <> 'completed'
       RETURNING id, title`,
      [input.deliverableId]
    );
    const response: AddVersionSuccess = {
      ok: true,
      deliverable,
      version: versionResult.rows[0],
      completedTasks: completedTasks.rows
    };
    await completeWorkflowMutation(client, mutationRecordId, response);
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function reviewDeliverableVersionInternally(input: {
  versionId: string;
  reviewerId: string;
  decision: ReviewDecision;
  comment?: string | null;
  idempotencyKey?: string | null;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const mutation = await claimWorkflowMutation<InternalReviewSuccess>(client, {
      actorId: input.reviewerId,
      operation: `deliverable-internal-review:${input.versionId}`,
      idempotencyKey: input.idempotencyKey,
      payload: {
        versionId: input.versionId,
        decision: input.decision,
        comment: input.comment ?? null
      }
    });
    if (mutation?.status === "replay") {
      await client.query("COMMIT");
      return mutation.response;
    }
    if (mutation?.status === "conflict" || mutation?.status === "in_progress") {
      await client.query("ROLLBACK");
      return idempotencyFailure(mutation.status);
    }
    const mutationRecordId = mutation?.status === "acquired" ? mutation.recordId : undefined;

    const accessResult = await client.query<InternalReviewAccess>(
      `SELECT d.id AS deliverable_id, d.project_id, p.name AS project_name, d.title, p.current_phase,
         d.status, dv.submitted_by,
         (SELECT id FROM deliverable_versions WHERE deliverable_id = d.id ORDER BY version_number DESC LIMIT 1) AS latest_version_id
       FROM deliverable_versions dv
       INNER JOIN deliverables d ON d.id = dv.deliverable_id AND d.deleted_at IS NULL
       INNER JOIN projects p ON p.id = d.project_id AND p.deleted_at IS NULL
       WHERE dv.id = $1 FOR UPDATE OF d`,
      [input.versionId]
    );
    const access = accessResult.rows[0];
    if (!access) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "not_found" as const };
    }
    if (access.current_phase === "delivery") {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "delivery_locked" as const };
    }
    if (access.latest_version_id !== input.versionId) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "not_latest" as const };
    }
    if (access.status !== "internal_review") {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "review_closed" as const };
    }

    const reviewResult = await client.query<ReviewRow>(
      `INSERT INTO deliverable_internal_reviews (deliverable_version_id, reviewer_id, decision, comment)
       VALUES ($1, $2, $3, $4)
       RETURNING id, deliverable_version_id, reviewer_id, ''::text AS reviewer_name, decision, comment, created_at`,
      [input.versionId, input.reviewerId, input.decision, input.comment ?? null]
    );
    const nextStatus = input.decision === "approved" ? "internal_approved" : "internal_changes_requested";
    await client.query(`UPDATE deliverables SET status = $1, updated_at = NOW() WHERE id = $2`, [nextStatus, access.deliverable_id]);
    if (input.decision === "changes_requested") {
      await client.query(
        `UPDATE tasks
         SET status = 'in_progress', completed_at = NULL, updated_at = NOW()
         WHERE id IN (
           SELECT task_id FROM deliverable_tasks WHERE deliverable_id = $1
         )
           AND deleted_at IS NULL`,
        [access.deliverable_id]
      );
    }
    const response: InternalReviewSuccess = {
      ok: true,
      review: reviewResult.rows[0],
      access,
      nextStatus
    };
    await completeWorkflowMutation(client, mutationRecordId, response);
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function submitDeliverableVersionToClient(input: {
  versionId: string;
  submittedBy: string;
  idempotencyKey?: string | null;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const mutation = await claimWorkflowMutation<ClientSubmissionSuccess>(client, {
      actorId: input.submittedBy,
      operation: `deliverable-client-submit:${input.versionId}`,
      idempotencyKey: input.idempotencyKey,
      payload: { versionId: input.versionId }
    });
    if (mutation?.status === "replay") {
      await client.query("COMMIT");
      return mutation.response;
    }
    if (mutation?.status === "conflict" || mutation?.status === "in_progress") {
      await client.query("ROLLBACK");
      return idempotencyFailure(mutation.status);
    }
    const mutationRecordId = mutation?.status === "acquired" ? mutation.recordId : undefined;

    const accessResult = await client.query<ClientSubmissionAccess>(
      `SELECT d.id AS deliverable_id, d.project_id, p.name AS project_name, d.title, p.current_phase,
         d.status, p.client_id,
         (SELECT id FROM deliverable_versions WHERE deliverable_id = d.id ORDER BY version_number DESC LIMIT 1) AS latest_version_id
       FROM deliverable_versions dv
       INNER JOIN deliverables d ON d.id = dv.deliverable_id AND d.deleted_at IS NULL
       INNER JOIN projects p ON p.id = d.project_id AND p.deleted_at IS NULL
       WHERE dv.id = $1 FOR UPDATE OF d`,
      [input.versionId]
    );
    const access = accessResult.rows[0];
    if (!access) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "not_found" as const };
    }
    if (access.current_phase === "delivery") {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "delivery_locked" as const };
    }
    if (access.latest_version_id !== input.versionId) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "not_latest" as const };
    }
    if (access.status !== "internal_approved") {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "internal_approval_required" as const };
    }

    await client.query(
      `UPDATE deliverable_versions
       SET client_submitted_by = COALESCE(client_submitted_by, $1),
           client_submitted_at = COALESCE(client_submitted_at, NOW()),
           client_withdrawn_by = NULL,
           client_withdrawn_at = NULL
       WHERE id = $2`,
      [input.submittedBy, input.versionId]
    );
    await client.query(
      `INSERT INTO deliverable_client_events (deliverable_version_id, event_type, actor_id)
       VALUES ($1, 'submitted', $2)`,
      [input.versionId, input.submittedBy]
    );
    await client.query(`UPDATE deliverables SET status = 'in_review', updated_at = NOW() WHERE id = $1`, [access.deliverable_id]);
    const response: ClientSubmissionSuccess = { ok: true, access };
    await completeWorkflowMutation(client, mutationRecordId, response);
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function withdrawDeliverableVersionFromClient(input: {
  versionId: string;
  withdrawnBy: string;
  idempotencyKey?: string | null;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const mutation = await claimWorkflowMutation<ClientWithdrawalSuccess>(client, {
      actorId: input.withdrawnBy,
      operation: `deliverable-client-withdraw:${input.versionId}`,
      idempotencyKey: input.idempotencyKey,
      payload: { versionId: input.versionId }
    });
    if (mutation?.status === "replay") {
      await client.query("COMMIT");
      return mutation.response;
    }
    if (mutation?.status === "conflict" || mutation?.status === "in_progress") {
      await client.query("ROLLBACK");
      return idempotencyFailure(mutation.status);
    }
    const mutationRecordId = mutation?.status === "acquired" ? mutation.recordId : undefined;

    const accessResult = await client.query<ClientWithdrawalAccess>(
      `SELECT d.id AS deliverable_id, d.project_id, p.name AS project_name, d.title, p.current_phase,
         d.status, p.client_id, dv.client_submitted_by, dv.client_submitted_at, dv.client_withdrawn_at,
         (SELECT id FROM deliverable_versions WHERE deliverable_id = d.id ORDER BY version_number DESC LIMIT 1) AS latest_version_id
       FROM deliverable_versions dv
       INNER JOIN deliverables d ON d.id = dv.deliverable_id AND d.deleted_at IS NULL
       INNER JOIN projects p ON p.id = d.project_id AND p.deleted_at IS NULL
       WHERE dv.id = $1 FOR UPDATE OF d, dv`,
      [input.versionId]
    );
    const access = accessResult.rows[0];
    if (!access) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "not_found" as const };
    }
    if (access.current_phase === "delivery") {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "delivery_locked" as const };
    }
    if (access.latest_version_id !== input.versionId) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "not_latest" as const };
    }
    if (access.status !== "in_review" || !access.client_submitted_at || access.client_withdrawn_at) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "review_closed" as const };
    }
    if (access.client_submitted_by !== input.withdrawnBy) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "not_submitter" as const };
    }

    await client.query(
      `UPDATE deliverable_versions
       SET client_withdrawn_by = $2, client_withdrawn_at = NOW()
       WHERE id = $1`,
      [input.versionId, input.withdrawnBy]
    );
    await client.query(
      `INSERT INTO deliverable_client_events (deliverable_version_id, event_type, actor_id)
       VALUES ($1, 'withdrawn', $2)`,
      [input.versionId, input.withdrawnBy]
    );
    await client.query(`UPDATE deliverables SET status = 'internal_approved', updated_at = NOW() WHERE id = $1`, [access.deliverable_id]);
    const response: ClientWithdrawalSuccess = { ok: true, access };
    await completeWorkflowMutation(client, mutationRecordId, response);
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function reviewDeliverableVersion(input: {
  versionId: string;
  reviewerId: string;
  decision: ReviewDecision;
  comment?: string | null;
  idempotencyKey?: string | null;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const mutation = await claimWorkflowMutation<ClientReviewSuccess>(client, {
      actorId: input.reviewerId,
      operation: `deliverable-client-review:${input.versionId}`,
      idempotencyKey: input.idempotencyKey,
      payload: {
        versionId: input.versionId,
        decision: input.decision,
        comment: input.comment ?? null
      }
    });
    if (mutation?.status === "replay") {
      await client.query("COMMIT");
      return mutation.response;
    }
    if (mutation?.status === "conflict" || mutation?.status === "in_progress") {
      await client.query("ROLLBACK");
      return idempotencyFailure(mutation.status);
    }
    const mutationRecordId = mutation?.status === "acquired" ? mutation.recordId : undefined;

    const accessResult = await client.query<ClientReviewAccess>(
      `SELECT d.id AS deliverable_id, d.project_id, p.name AS project_name, d.title,
         p.current_phase, p.client_id, d.status,
         (SELECT id FROM deliverable_versions
          WHERE deliverable_id = d.id
            AND client_submitted_at IS NOT NULL
            AND client_withdrawn_at IS NULL
          ORDER BY version_number DESC LIMIT 1) AS latest_version_id
       FROM deliverable_versions dv
       INNER JOIN deliverables d ON d.id = dv.deliverable_id AND d.deleted_at IS NULL
       INNER JOIN projects p ON p.id = d.project_id AND p.deleted_at IS NULL
       INNER JOIN client_memberships cm ON cm.client_id = p.client_id AND cm.user_id = $2
       WHERE dv.id = $1
         AND dv.client_submitted_at IS NOT NULL
         AND dv.client_withdrawn_at IS NULL
       FOR UPDATE OF d`,
      [input.versionId, input.reviewerId]
    );
    const access = accessResult.rows[0];
    if (!access) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "not_found" as const };
    }
    if (access.current_phase === "delivery") {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "delivery_locked" as const };
    }
    if (access.latest_version_id !== input.versionId) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "not_latest" as const };
    }
    if (access.status !== "in_review") {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "review_closed" as const };
    }

    const reviewResult = await client.query<ReviewRow>(
      `INSERT INTO deliverable_reviews (deliverable_version_id, reviewer_id, decision, comment)
       VALUES ($1, $2, $3, $4)
       RETURNING id, deliverable_version_id, reviewer_id, ''::text AS reviewer_name, decision, comment, created_at`,
      [input.versionId, input.reviewerId, input.decision, input.comment ?? null]
    );
    await client.query(`UPDATE deliverables SET status = $1, updated_at = NOW() WHERE id = $2`, [input.decision, access.deliverable_id]);
    const response: ClientReviewSuccess = { ok: true, review: reviewResult.rows[0], access };
    await completeWorkflowMutation(client, mutationRecordId, response);
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createDeliverableMessage(input: {
  versionId: string;
  authorId: string;
  body: string;
  idempotencyKey?: string | null;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const mutation = await claimWorkflowMutation<DeliverableMessageSuccess>(client, {
      actorId: input.authorId,
      operation: `deliverable-message-create:${input.versionId}`,
      idempotencyKey: input.idempotencyKey,
      payload: { versionId: input.versionId, body: input.body }
    });
    if (mutation?.status === "replay") {
      await client.query("COMMIT");
      return mutation.response;
    }
    if (mutation?.status === "conflict" || mutation?.status === "in_progress") {
      await client.query("ROLLBACK");
      return idempotencyFailure(mutation.status);
    }
    const mutationRecordId = mutation?.status === "acquired" ? mutation.recordId : undefined;

    const access = await client.query<DeliverableMessageContext>(
      `SELECT d.project_id, d.id AS deliverable_id, d.title, p.current_phase, p.client_id
       FROM deliverable_versions dv
       INNER JOIN deliverables d ON d.id = dv.deliverable_id AND d.deleted_at IS NULL
       INNER JOIN projects p ON p.id = d.project_id AND p.deleted_at IS NULL
       WHERE dv.id = $1
         AND dv.client_submitted_at IS NOT NULL
         AND dv.client_withdrawn_at IS NULL
         AND d.status IN ('in_review', 'changes_requested', 'approved')
       FOR UPDATE OF d`,
      [input.versionId]
    );
    const context = access.rows[0];
    if (!context) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "not_found" as const };
    }
    if (context.current_phase === "delivery") {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "delivery_locked" as const };
    }

    const result = await client.query<MessageRow>(
      `INSERT INTO deliverable_messages (deliverable_version_id, author_id, body, client_visible)
       VALUES ($1, $2, $3, TRUE)
       RETURNING id, deliverable_version_id, author_id,
         (SELECT name FROM users WHERE id = deliverable_messages.author_id) AS author_name,
         (SELECT account_type FROM users WHERE id = deliverable_messages.author_id) AS author_type,
         body, created_at`,
      [input.versionId, input.authorId, input.body]
    );
    const response: DeliverableMessageSuccess = { ok: true, message: result.rows[0], context };
    await completeWorkflowMutation(client, mutationRecordId, response);
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function forwardDeliverableFeedback(input: {
  versionId: string;
  sourceReviewId?: string | null;
  taskIds: string[];
  forwardedBy: string;
  body: string;
  idempotencyKey?: string | null;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const mutation = await claimWorkflowMutation<FeedbackForwardSuccess>(client, {
      actorId: input.forwardedBy,
      operation: `deliverable-feedback-forward:${input.versionId}`,
      idempotencyKey: input.idempotencyKey,
      payload: {
        versionId: input.versionId,
        sourceReviewId: input.sourceReviewId ?? null,
        taskIds: [...new Set(input.taskIds)].sort(),
        body: input.body
      }
    });
    if (mutation?.status === "replay") {
      await client.query("COMMIT");
      return mutation.response;
    }
    if (mutation?.status === "conflict" || mutation?.status === "in_progress") {
      await client.query("ROLLBACK");
      return idempotencyFailure(mutation.status);
    }
    const mutationRecordId = mutation?.status === "acquired" ? mutation.recordId : undefined;

    const contextResult = await client.query<FeedbackForwardContext>(
      `SELECT d.project_id, d.id AS deliverable_id, d.title, d.status, project.current_phase,
         (SELECT id FROM deliverable_versions
          WHERE deliverable_id = d.id ORDER BY version_number DESC LIMIT 1) AS latest_version_id
       FROM deliverable_versions dv
       INNER JOIN deliverables d ON d.id = dv.deliverable_id AND d.deleted_at IS NULL
       INNER JOIN projects project ON project.id = d.project_id AND project.deleted_at IS NULL
       WHERE dv.id = $1
       FOR UPDATE OF d`,
      [input.versionId]
    );
    const context = contextResult.rows[0];
    if (!context) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "not_found" as const };
    }
    if (context.current_phase === "delivery") {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "delivery_locked" as const };
    }
    if (context.latest_version_id !== input.versionId) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "not_latest" as const };
    }
    if (context.status !== "changes_requested") {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "review_closed" as const };
    }
    const taskIds = [...new Set(input.taskIds)];
    const tasksResult = await client.query<{ id: string; title: string; previous_status: string }>(
      `SELECT task.id, task.title, task.status::text AS previous_status
       FROM deliverable_tasks link
       INNER JOIN tasks task ON task.id = link.task_id AND task.deleted_at IS NULL
       WHERE link.deliverable_id = $1 AND task.id = ANY($2::uuid[])`,
      [context.deliverable_id, taskIds]
    );
    if (tasksResult.rows.length !== taskIds.length) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "invalid_tasks" as const };
    }
    if (input.sourceReviewId) {
      const review = await client.query<{ id: string }>(
        `SELECT dr.id FROM deliverable_reviews dr
         WHERE dr.id = $1 AND dr.deliverable_version_id = $2`,
        [input.sourceReviewId, input.versionId]
      );
      if (!review.rows[0]) {
        await client.query("ROLLBACK");
        return { ok: false as const, reason: "invalid_review" as const };
      }
    }

    for (const task of tasksResult.rows) {
      await client.query(
        `INSERT INTO deliverable_feedback_forwards (
           deliverable_version_id, source_review_id, task_id, forwarded_by, body
         ) VALUES ($1, $2, $3, $4, $5)`,
        [input.versionId, input.sourceReviewId ?? null, task.id, input.forwardedBy, input.body]
      );
      await client.query(
        `INSERT INTO task_comments (task_id, user_id, body, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [task.id, input.forwardedBy, input.body]
      );
    }

    await client.query(
      `UPDATE tasks
       SET status = 'in_progress', completed_at = NULL, updated_at = NOW()
       WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [taskIds]
    );

    const recipients = await client.query<{ user_id: string; task_id: string }>(
      `SELECT DISTINCT task_assignee.user_id, task_assignee.task_id
       FROM task_assignees task_assignee
       WHERE task_assignee.task_id = ANY($1::uuid[])
       UNION
       SELECT DISTINCT task.assigned_to AS user_id, task.id AS task_id
       FROM tasks task
       WHERE task.id = ANY($1::uuid[]) AND task.assigned_to IS NOT NULL`,
      [taskIds]
    );
    const response: FeedbackForwardSuccess = {
      ok: true,
      context,
      tasks: tasksResult.rows,
      recipients: recipients.rows
    };
    await completeWorkflowMutation(client, mutationRecordId, response);
    await client.query("COMMIT");
    return response;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listClientReviewerIds(clientId: string) {
  const result = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM client_memberships WHERE client_id = $1 AND role = 'reviewer'`,
    [clientId]
  );
  return result.rows.map((row) => row.user_id);
}
