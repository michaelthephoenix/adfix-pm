import { pool } from "../db/pool.js";

type UserRow = {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export async function listUsers(input?: { page?: number; pageSize?: number }) {
  const page = input?.page ?? 1;
  const pageSize = input?.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const [dataResult, countResult] = await Promise.all([
    pool.query<UserRow>(
      `SELECT
         id,
         email,
         name,
         avatar_url,
         is_active,
         last_login_at,
         created_at,
         updated_at
       FROM users
       WHERE deleted_at IS NULL
       ORDER BY created_at ASC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    ),
    pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM users
       WHERE deleted_at IS NULL`
    )
  ]);

  return {
    rows: dataResult.rows,
    total: Number(countResult.rows[0]?.total ?? 0)
  };
}

export async function getUserById(userId: string) {
  const result = await pool.query<UserRow>(
    `SELECT
       id,
       email,
       name,
       avatar_url,
       is_active,
       last_login_at,
       created_at,
       updated_at
     FROM users
     WHERE id = $1
       AND deleted_at IS NULL
     LIMIT 1`,
    [userId]
  );

  return result.rows[0] ?? null;
}

export async function updateUserProfile(
  userId: string,
  input: {
    name?: string;
    avatarUrl?: string | null;
  }
) {
  const fields: string[] = [];
  const values: Array<string | null> = [];

  if (typeof input.name !== "undefined") {
    fields.push(`name = $${fields.length + 1}`);
    values.push(input.name);
  }
  if (typeof input.avatarUrl !== "undefined") {
    fields.push(`avatar_url = $${fields.length + 1}`);
    values.push(input.avatarUrl);
  }

  if (fields.length === 0) {
    return getUserById(userId);
  }

  fields.push("updated_at = NOW()");

  const result = await pool.query<UserRow>(
    `UPDATE users
     SET ${fields.join(", ")}
     WHERE id = $${fields.length}
       AND deleted_at IS NULL
     RETURNING
       id,
       email,
       name,
       avatar_url,
       is_active,
       last_login_at,
       created_at,
       updated_at`,
    [...values, userId]
  );

  return result.rows[0] ?? null;
}
