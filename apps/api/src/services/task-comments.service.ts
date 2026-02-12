import { pool } from "../db/pool.js";

type TaskCommentRow = {
  id: string;
  task_id: string;
  user_id: string;
  body: string;
  created_at: Date;
  updated_at: Date;
};

type ListTaskCommentsInput = {
  taskId: string;
  page?: number;
  pageSize?: number;
  sortOrder?: "asc" | "desc";
};

export async function listTaskComments(input: ListTaskCommentsInput) {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const orderDirection = input.sortOrder === "asc" ? "ASC" : "DESC";

  const [dataResult, countResult] = await Promise.all([
    pool.query<TaskCommentRow>(
      `SELECT
         id,
         task_id,
         user_id,
         body,
         created_at,
         updated_at
       FROM task_comments
       WHERE task_id = $1
         AND deleted_at IS NULL
       ORDER BY created_at ${orderDirection}
       LIMIT $2
       OFFSET $3`,
      [input.taskId, pageSize.toString(), offset.toString()]
    ),
    pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM task_comments
       WHERE task_id = $1
         AND deleted_at IS NULL`,
      [input.taskId]
    )
  ]);

  return {
    rows: dataResult.rows,
    total: Number(countResult.rows[0]?.total ?? 0)
  };
}

export async function createTaskComment(input: {
  taskId: string;
  userId: string;
  body: string;
}) {
  const result = await pool.query<TaskCommentRow>(
    `INSERT INTO task_comments (task_id, user_id, body, created_at, updated_at)
     VALUES ($1, $2, $3, NOW(), NOW())
     RETURNING id, task_id, user_id, body, created_at, updated_at`,
    [input.taskId, input.userId, input.body]
  );

  return result.rows[0];
}

export async function deleteTaskComment(input: {
  taskId: string;
  commentId: string;
}) {
  const result = await pool.query<{ id: string }>(
    `UPDATE task_comments
     SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1
       AND task_id = $2
       AND deleted_at IS NULL
     RETURNING id`,
    [input.commentId, input.taskId]
  );

  return result.rowCount === 1;
}
