import { pool } from "../db/pool.js";

export async function insertActivityLog(input: {
  userId: string;
  action: string;
  details?: Record<string, unknown>;
  projectId?: string | null;
}) {
  await pool.query(
    `INSERT INTO activity_log (project_id, user_id, action, details, created_at)
     VALUES ($1, $2, $3, $4::jsonb, NOW())`,
    [input.projectId ?? null, input.userId, input.action, JSON.stringify(input.details ?? {})]
  );
}

export async function listProjectActivity(projectId: string, limit = 100) {
  const result = await pool.query<{
    id: string;
    project_id: string | null;
    user_id: string | null;
    action: string;
    details: Record<string, unknown>;
    created_at: Date;
    user_name: string | null;
    user_email: string | null;
  }>(
    `SELECT
       a.id,
       a.project_id,
       a.user_id,
       a.action,
       a.details,
       a.created_at,
       u.name AS user_name,
       u.email AS user_email
     FROM activity_log a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.project_id = $1
     ORDER BY a.created_at DESC
     LIMIT $2`,
    [projectId, limit]
  );

  return result.rows;
}

export async function listClientActivity(clientId: string, limit = 50) {
  const result = await pool.query<{
    id: string;
    project_id: string | null;
    user_id: string | null;
    action: string;
    details: Record<string, unknown>;
    created_at: Date;
    user_name: string | null;
    user_email: string | null;
    project_name: string | null;
  }>(
    `SELECT
       a.id,
       a.project_id,
       a.user_id,
       a.action,
       a.details,
       a.created_at,
       u.name AS user_name,
       u.email AS user_email,
       p.name AS project_name
     FROM activity_log a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN projects p ON p.id = a.project_id
     WHERE (a.details->>'clientId') = $1
        OR p.client_id = $1::uuid
     ORDER BY a.created_at DESC
     LIMIT $2`,
    [clientId, limit]
  );

  return result.rows;
}
