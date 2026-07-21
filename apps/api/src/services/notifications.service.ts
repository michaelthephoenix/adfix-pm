import type { PoolClient, QueryResultRow } from "pg";
import { pool } from "../db/pool.js";

export type NotificationActionStatus = "open" | "resolved" | "superseded";
type NotificationView = "all" | "unread" | "action_required" | "resolved" | "archived";
type NotificationAudience = "staff" | "client";

type NotificationRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  task_id: string | null;
  type: string;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  is_read: boolean;
  read_at: Date | null;
  action_required: boolean;
  action_status: NotificationActionStatus;
  resolved_at: Date | null;
  resolution_reason: string | null;
  archived_at: Date | null;
  created_at: Date;
};

type NotificationListRow = NotificationRow & {
  target_available: boolean;
};

type NotificationInput = {
  projectId?: string | null;
  taskId?: string | null;
  type: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  actionRequired?: boolean;
  dedupeKey?: string | null;
};

type NotificationOutboxPayload = {
  recipientIds: string[];
  notification: Omit<NotificationInput, "dedupeKey">;
  excludeUserIds: string[];
};

export type NotificationQueryable = Pick<PoolClient, "query">;

type ListNotificationsFilter = {
  userId: string;
  unreadOnly?: boolean;
  actionStatus?: NotificationActionStatus;
  view?: NotificationView;
  page?: number;
  pageSize?: number;
  sortOrder?: "asc" | "desc";
};

const clientNotificationTypes = new Set([
  "deliverable_client_review_requested",
  "deliverable_client_review_withdrawn",
  "deliverable_staff_reply",
  "deliverable_client_review_completed",
  "client_access_role_changed",
  "client_access_revoked"
]);

const actionRequiredTypes = new Set([
  "deliverable_internal_review_requested",
  "deliverable_internal_changes_requested",
  "deliverable_client_submission_ready",
  "deliverable_client_review_requested",
  "deliverable_changes_requested",
  "deliverable_client_message",
  "client_feedback_forwarded",
  "task_assigned"
]);

function notificationAudience(type: string): NotificationAudience {
  return clientNotificationTypes.has(type) ? "client" : "staff";
}

function isActionRequired(input: NotificationInput) {
  return input.actionRequired ?? actionRequiredTypes.has(input.type);
}

function notificationColumns() {
  return `id, user_id, project_id, task_id, type, title, message, metadata,
    is_read, read_at, action_required, action_status, resolved_at, resolution_reason, archived_at, created_at`;
}

function notificationTargetAvailabilitySql() {
  return `CASE
    WHEN n.project_id IS NULL THEN TRUE
    WHEN NOT EXISTS (
      SELECT 1
      FROM projects target_project
      INNER JOIN users target_user ON target_user.id = n.user_id
      WHERE target_project.id = n.project_id
        AND target_project.deleted_at IS NULL
        AND (
          (
            target_user.account_type = 'staff'
            AND (
              target_project.created_by = n.user_id
              OR EXISTS (
                SELECT 1 FROM project_team target_team
                WHERE target_team.project_id = target_project.id
                  AND target_team.user_id = n.user_id
              )
            )
          )
          OR (
            target_user.account_type = 'client'
            AND EXISTS (
              SELECT 1 FROM client_memberships target_membership
              WHERE target_membership.client_id = target_project.client_id
                AND target_membership.user_id = n.user_id
            )
          )
        )
    ) THEN FALSE
    WHEN n.task_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM tasks target_task
      WHERE target_task.id = n.task_id
        AND target_task.project_id = n.project_id
        AND target_task.deleted_at IS NULL
    ) THEN FALSE
    ELSE TRUE
  END`;
}

async function filterEligibleRecipientIds(
  queryable: NotificationQueryable,
  userIds: Iterable<string>,
  input: Pick<NotificationInput, "type" | "projectId">
) {
  const uniqueIds = [...new Set(userIds)].filter(Boolean);
  if (uniqueIds.length === 0) return [];
  const audience = notificationAudience(input.type);
  const result = await queryable.query<{ id: string }>(
    `SELECT u.id
     FROM users u
     WHERE u.id = ANY($1::uuid[])
       AND u.deleted_at IS NULL
       AND u.is_active = TRUE
       AND u.account_type = $2
       AND (
         $3::uuid IS NULL
         OR (
           $2 = 'staff'
           AND EXISTS (
             SELECT 1
             FROM projects p
             WHERE p.id = $3
               AND p.deleted_at IS NULL
               AND (
                 p.created_by = u.id
                 OR EXISTS (
                   SELECT 1 FROM project_team pt
                   WHERE pt.project_id = p.id AND pt.user_id = u.id
                 )
               )
           )
         )
         OR (
           $2 = 'client'
           AND EXISTS (
             SELECT 1
             FROM projects p
             INNER JOIN client_memberships cm
               ON cm.client_id = p.client_id AND cm.user_id = u.id
             WHERE p.id = $3 AND p.deleted_at IS NULL
           )
         )
       )
     ORDER BY u.id`,
    [uniqueIds, audience, input.projectId ?? null]
  );
  return result.rows.map((row) => row.id);
}

async function insertNotification(
  queryable: NotificationQueryable,
  input: NotificationInput & { userId: string }
) {
  const result = await queryable.query<NotificationRow>(
    `INSERT INTO notifications (
       user_id, project_id, task_id, type, title, message, metadata,
       is_read, read_at, action_required, action_status, dedupe_key, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, FALSE, NULL, $8, 'open', $9, NOW())
     ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING ${notificationColumns()}`,
    [
      input.userId,
      input.projectId ?? null,
      input.taskId ?? null,
      input.type,
      input.title,
      input.message,
      JSON.stringify(input.metadata ?? {}),
      isActionRequired(input),
      input.dedupeKey ?? null
    ]
  );
  return result.rows[0] ?? null;
}

export async function listNotifications(filter: ListNotificationsFilter) {
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const sortOrder = filter.sortOrder === "asc" ? "ASC" : "DESC";

  const where: string[] = ["n.user_id = $1"];
  const values: Array<string | number | boolean> = [filter.userId];

  const view = filter.view ?? (filter.unreadOnly ? "unread" : "all");
  if (view === "archived") {
    where.push("n.archived_at IS NOT NULL");
  } else {
    where.push("n.archived_at IS NULL");
  }
  if (view === "unread") {
    where.push(`n.is_read = FALSE AND (n.action_required = FALSE OR n.action_status = 'open')`);
  } else if (view === "action_required") {
    where.push(`n.action_required = TRUE AND n.action_status = 'open'`);
  } else if (view === "resolved") {
    where.push(`n.action_required = TRUE AND n.action_status IN ('resolved', 'superseded')`);
  }
  if (filter.actionStatus) {
    values.push(filter.actionStatus);
    where.push(`n.action_required = TRUE AND n.action_status = $${values.length}`);
  }

  const [dataResult, countResult, unreadCountResult, openActionCountResult] = await Promise.all([
    pool.query<NotificationListRow>(
      `SELECT ${notificationColumns()}, ${notificationTargetAvailabilitySql()} AS target_available
       FROM notifications n
       WHERE ${where.join(" AND ")}
       ORDER BY n.created_at ${sortOrder}
       LIMIT $${values.length + 1}
       OFFSET $${values.length + 2}`,
      [...values, pageSize, offset]
    ),
    pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM notifications n WHERE ${where.join(" AND ")}`,
      values
    ),
    pool.query<{ unread_count: string }>(
      `SELECT COUNT(*)::text AS unread_count
       FROM notifications
       WHERE user_id = $1 AND archived_at IS NULL AND is_read = FALSE
         AND (action_required = FALSE OR action_status = 'open')`,
      [filter.userId]
    ),
    pool.query<{ open_action_count: string }>(
      `SELECT COUNT(*)::text AS open_action_count
       FROM notifications
       WHERE user_id = $1 AND archived_at IS NULL
         AND action_required = TRUE AND action_status = 'open'`,
      [filter.userId]
    )
  ]);

  return {
    rows: dataResult.rows,
    total: Number(countResult.rows[0]?.total ?? 0),
    unreadCount: Number(unreadCountResult.rows[0]?.unread_count ?? 0),
    openActionCount: Number(openActionCountResult.rows[0]?.open_action_count ?? 0)
  };
}

async function createNotification(input: NotificationInput & { userId: string }) {
  const eligible = await filterEligibleRecipientIds(pool, [input.userId], input);
  if (!eligible.includes(input.userId)) return null;
  return insertNotification(pool, input);
}

async function enqueueNotificationBatch(
  queryable: NotificationQueryable,
  eventKey: string,
  payload: NotificationOutboxPayload
) {
  const result = await queryable.query<{ id: string; status: string }>(
    `INSERT INTO notification_outbox (event_key, payload)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (event_key) DO UPDATE SET updated_at = notification_outbox.updated_at
     WHERE notification_outbox.payload = EXCLUDED.payload
     RETURNING id, status`,
    [eventKey, JSON.stringify(payload)]
  );
  if (!result.rows[0]) {
    throw new Error(`Notification event key ${eventKey} was reused with a different payload`);
  }
  return result.rows[0];
}

export function enqueueNotificationEvent(
  queryable: NotificationQueryable,
  eventKey: string,
  userIds: Iterable<string>,
  input: Omit<NotificationInput, "dedupeKey">,
  options: { excludeUserIds?: Iterable<string> } = {}
) {
  return enqueueNotificationBatch(queryable, eventKey, {
    recipientIds: [...new Set(userIds)].filter(Boolean).sort(),
    notification: input,
    excludeUserIds: [...new Set(options.excludeUserIds ?? [])].sort()
  });
}

async function markOutboxFailure(eventKey: string, error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown notification delivery error";
  await pool.query(
    `UPDATE notification_outbox
     SET status = 'failed', attempts = attempts + 1, last_error = $2,
       available_at = NOW() + LEAST(INTERVAL '5 minutes', (attempts + 1) * INTERVAL '5 seconds'),
       updated_at = NOW()
     WHERE event_key = $1 AND status <> 'completed'`,
    [eventKey, message.slice(0, 4000)]
  );
}

export async function dispatchNotificationOutboxEvent(eventKey: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const eventResult = await client.query<{
      status: "pending" | "processing" | "completed" | "failed";
      payload: NotificationOutboxPayload;
    }>(
      `SELECT status, payload
       FROM notification_outbox
       WHERE event_key = $1
       FOR UPDATE`,
      [eventKey]
    );
    const event = eventResult.rows[0];
    if (!event || event.status === "completed") {
      await client.query("COMMIT");
      return { deliveredCount: 0, alreadyProcessed: true };
    }

    await client.query(
      `UPDATE notification_outbox
       SET status = 'processing', attempts = attempts + 1, updated_at = NOW()
       WHERE event_key = $1`,
      [eventKey]
    );

    const excluded = new Set(event.payload.excludeUserIds);
    const candidates = event.payload.recipientIds.filter((userId) => !excluded.has(userId));
    const recipients = await filterEligibleRecipientIds(client, candidates, event.payload.notification);
    let deliveredCount = 0;
    for (const userId of recipients) {
      const notification = await insertNotification(client, {
        ...event.payload.notification,
        userId,
        dedupeKey: `${eventKey}:${userId}`
      });
      if (notification) deliveredCount += 1;
    }

    await client.query(
      `UPDATE notification_outbox
       SET status = 'completed', processed_at = NOW(), last_error = NULL, updated_at = NOW()
       WHERE event_key = $1`,
      [eventKey]
    );
    await client.query("COMMIT");
    return { deliveredCount, alreadyProcessed: false };
  } catch (error) {
    await client.query("ROLLBACK");
    await markOutboxFailure(eventKey, error);
    throw error;
  } finally {
    client.release();
  }
}

export async function deliverQueuedNotificationEvent(eventKey: string) {
  try {
    const result = await dispatchNotificationOutboxEvent(eventKey);
    return { ...result, queuedForRetry: false };
  } catch (error) {
    console.error(`Notification event ${eventKey} was queued for retry:`, error);
    return { deliveredCount: 0, alreadyProcessed: false, queuedForRetry: true };
  }
}

async function processPendingNotificationOutbox(limit = 25) {
  const result = await pool.query<{ event_key: string }>(
    `SELECT event_key
     FROM notification_outbox
     WHERE status IN ('pending', 'failed') AND available_at <= NOW()
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  );
  for (const event of result.rows) {
    await dispatchNotificationOutboxEvent(event.event_key).catch((error) => {
      console.error(`Notification outbox delivery failed for ${event.event_key}:`, error);
    });
  }
  return { processedCount: result.rowCount };
}

export function startNotificationOutboxWorker(intervalMs = 5_000) {
  void processPendingNotificationOutbox();
  const timer = setInterval(() => void processPendingNotificationOutbox(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

export async function createNotificationsForUsers(
  userIds: Iterable<string>,
  input: Omit<NotificationInput, "dedupeKey">,
  options: { excludeUserIds?: Iterable<string>; eventKey?: string } = {}
) {
  const recipients = [...new Set(userIds)].filter(Boolean);
  const excludeUserIds = [...new Set(options.excludeUserIds ?? [])];
  if (recipients.length === 0) return [];

  if (options.eventKey) {
    await enqueueNotificationEvent(pool, options.eventKey, recipients, input, { excludeUserIds });
    await deliverQueuedNotificationEvent(options.eventKey);
    return [];
  }

  const excluded = new Set(excludeUserIds);
  return Promise.all(
    recipients
      .filter((userId) => !excluded.has(userId))
      .map((userId) => createNotification({ ...input, userId }))
  );
}

async function transitionActionNotifications(input: {
  whereSql: string;
  values: Array<string | string[]>;
  nextStatus: Exclude<NotificationActionStatus, "open">;
  reason: string;
  queryable?: NotificationQueryable;
}) {
  const result = await (input.queryable ?? pool).query<{ id: string }>(
    `UPDATE notifications
     SET action_status = $1, resolved_at = COALESCE(resolved_at, NOW()), resolution_reason = $2
     WHERE action_required = TRUE AND action_status = 'open' AND ${input.whereSql}
     RETURNING id`,
    [input.nextStatus, input.reason, ...input.values]
  );
  return { updatedCount: result.rowCount };
}

export function resolveActionNotificationsForVersion(
  versionId: string,
  types: string[],
  reason: string,
  nextStatus: Exclude<NotificationActionStatus, "open"> = "resolved"
) {
  if (types.length === 0) return Promise.resolve({ updatedCount: 0 });
  return transitionActionNotifications({
    whereSql: `metadata ->> 'versionId' = $3 AND type = ANY($4::text[])`,
    values: [versionId, types],
    nextStatus,
    reason
  });
}

export function supersedeActionNotificationsForDeliverable(
  deliverableId: string,
  currentVersionId: string
) {
  return transitionActionNotifications({
    whereSql: `metadata ->> 'deliverableId' = $3 AND COALESCE(metadata ->> 'versionId', '') <> $4`,
    values: [deliverableId, currentVersionId],
    nextStatus: "superseded",
    reason: "new_version"
  });
}

export function resolveProjectActionNotifications(
  projectId: string,
  reason = "project_entered_delivery",
  queryable?: NotificationQueryable
) {
  return transitionActionNotifications({
    whereSql: `project_id = $3`,
    values: [projectId],
    nextStatus: "resolved",
    reason,
    queryable
  });
}

export function resolveTaskActionNotifications(
  taskId: string,
  reason = "task_completed",
  userIds?: string[],
  queryable?: NotificationQueryable
) {
  const userFilter = userIds?.length ? ` AND user_id = ANY($4::uuid[])` : "";
  return transitionActionNotifications({
    whereSql: `task_id = $3${userFilter}`,
    values: userIds?.length ? [taskId, userIds] : [taskId],
    nextStatus: "resolved",
    reason,
    queryable
  });
}

export async function markNotificationRead(notificationId: string, userId: string) {
  const result = await pool.query<NotificationRow>(
    `UPDATE notifications
     SET is_read = TRUE, read_at = COALESCE(read_at, NOW())
     WHERE id = $1 AND user_id = $2
     RETURNING ${notificationColumns()}`,
    [notificationId, userId]
  );
  return result.rows[0] ?? null;
}

export async function markAllNotificationsRead(userId: string) {
  const result = await pool.query<QueryResultRow>(
    `UPDATE notifications
     SET is_read = TRUE, read_at = COALESCE(read_at, NOW())
     WHERE user_id = $1 AND archived_at IS NULL AND is_read = FALSE
     RETURNING id`,
    [userId]
  );
  return { updatedCount: result.rowCount };
}

export async function archiveNotification(notificationId: string, userId: string) {
  const result = await pool.query<NotificationRow>(
    `UPDATE notifications
     SET archived_at = NOW(), is_read = TRUE, read_at = COALESCE(read_at, NOW())
     WHERE id = $1 AND user_id = $2
       AND (action_required = FALSE OR action_status <> 'open')
       AND archived_at IS NULL
     RETURNING ${notificationColumns()}`,
    [notificationId, userId]
  );
  if (result.rows[0]) return { ok: true as const, notification: result.rows[0] };

  const existing = await pool.query<{
    action_required: boolean;
    action_status: NotificationActionStatus;
    target_available: boolean;
  }>(
    `SELECT action_required, action_status, ${notificationTargetAvailabilitySql()} AS target_available
     FROM notifications n WHERE id = $1 AND user_id = $2`,
    [notificationId, userId]
  );
  if (!existing.rows[0]) return { ok: false as const, reason: "not_found" as const };
  if (!existing.rows[0].target_available) {
    const staleResult = await pool.query<NotificationRow>(
      `UPDATE notifications
       SET archived_at = NOW(), is_read = TRUE, read_at = COALESCE(read_at, NOW())
       WHERE id = $1 AND user_id = $2 AND archived_at IS NULL
       RETURNING ${notificationColumns()}`,
      [notificationId, userId]
    );
    return { ok: true as const, notification: staleResult.rows[0] ?? null };
  }
  if (existing.rows[0].action_required && existing.rows[0].action_status === "open") {
    return { ok: false as const, reason: "action_required" as const };
  }
  return { ok: true as const, notification: null };
}

export async function restoreNotification(notificationId: string, userId: string) {
  const result = await pool.query<NotificationRow>(
    `UPDATE notifications
     SET archived_at = NULL
     WHERE id = $1 AND user_id = $2 AND archived_at IS NOT NULL
     RETURNING ${notificationColumns()}`,
    [notificationId, userId]
  );
  return result.rows[0] ?? null;
}
