import { pool } from "../db/pool.js";

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
  created_at: Date;
};

type ListNotificationsFilter = {
  userId: string;
  unreadOnly?: boolean;
  page?: number;
  pageSize?: number;
  sortOrder?: "asc" | "desc";
};

export async function listNotifications(filter: ListNotificationsFilter) {
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const sortOrder = filter.sortOrder === "asc" ? "ASC" : "DESC";

  const where: string[] = ["n.user_id = $1"];
  const values: string[] = [filter.userId];

  if (filter.unreadOnly === true) {
    where.push("n.is_read = FALSE");
  }

  const [dataResult, countResult, unreadCountResult] = await Promise.all([
    pool.query<NotificationRow>(
      `SELECT
         n.id,
         n.user_id,
         n.project_id,
         n.task_id,
         n.type,
         n.title,
         n.message,
         n.metadata,
         n.is_read,
         n.read_at,
         n.created_at
       FROM notifications n
       WHERE ${where.join(" AND ")}
       ORDER BY n.created_at ${sortOrder}
       LIMIT $${values.length + 1}
       OFFSET $${values.length + 2}`,
      [...values, pageSize.toString(), offset.toString()]
    ),
    pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM notifications n
       WHERE ${where.join(" AND ")}`,
      values
    ),
    pool.query<{ unread_count: string }>(
      `SELECT COUNT(*)::text AS unread_count
       FROM notifications
       WHERE user_id = $1
         AND is_read = FALSE`,
      [filter.userId]
    )
  ]);

  return {
    rows: dataResult.rows,
    total: Number(countResult.rows[0]?.total ?? 0),
    unreadCount: Number(unreadCountResult.rows[0]?.unread_count ?? 0)
  };
}

export async function createNotification(input: {
  userId: string;
  projectId?: string | null;
  taskId?: string | null;
  type: string;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}) {
  const result = await pool.query<NotificationRow>(
    `INSERT INTO notifications (
       user_id,
       project_id,
       task_id,
       type,
       title,
       message,
       metadata,
       is_read,
       read_at,
       created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, FALSE, NULL, NOW())
     RETURNING
       id, user_id, project_id, task_id, type, title, message, metadata, is_read, read_at, created_at`,
    [
      input.userId,
      input.projectId ?? null,
      input.taskId ?? null,
      input.type,
      input.title,
      input.message,
      JSON.stringify(input.metadata ?? {})
    ]
  );

  return result.rows[0];
}

export async function markNotificationRead(notificationId: string, userId: string) {
  const result = await pool.query<NotificationRow>(
    `UPDATE notifications
     SET
       is_read = TRUE,
       read_at = COALESCE(read_at, NOW())
     WHERE id = $1
       AND user_id = $2
     RETURNING
       id, user_id, project_id, task_id, type, title, message, metadata, is_read, read_at, created_at`,
    [notificationId, userId]
  );

  return result.rows[0] ?? null;
}

export async function markAllNotificationsRead(userId: string) {
  const result = await pool.query<{ id: string }>(
    `UPDATE notifications
     SET
       is_read = TRUE,
       read_at = COALESCE(read_at, NOW())
     WHERE user_id = $1
       AND is_read = FALSE
     RETURNING id`,
    [userId]
  );

  return {
    updatedCount: result.rowCount
  };
}
