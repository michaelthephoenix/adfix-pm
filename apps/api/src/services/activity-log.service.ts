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

