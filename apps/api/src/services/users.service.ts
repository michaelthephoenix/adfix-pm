import { pool } from "../db/pool.js";

type UserRow = {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  is_active: boolean;
  is_admin: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type AuditLogRow = {
  id: string;
  project_id: string | null;
  user_id: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: Date;
  user_name: string | null;
  user_email: string | null;
};

export async function listUsers(input?: {
  page?: number;
  pageSize?: number;
  sortBy?: "createdAt" | "updatedAt" | "name" | "email" | "lastLoginAt";
  sortOrder?: "asc" | "desc";
}) {
  const sortBy = input?.sortBy ?? "createdAt";
  const sortOrder = input?.sortOrder ?? "asc";
  const page = input?.page ?? 1;
  const pageSize = input?.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const orderColumnMap: Record<"createdAt" | "updatedAt" | "name" | "email" | "lastLoginAt", string> = {
    createdAt: "created_at",
    updatedAt: "updated_at",
    name: "name",
    email: "email",
    lastLoginAt: "last_login_at"
  };
  const orderColumn = orderColumnMap[sortBy];
  const orderDirection = sortOrder.toUpperCase() === "DESC" ? "DESC" : "ASC";

  const [dataResult, countResult] = await Promise.all([
    pool.query<UserRow>(
      `SELECT
         id,
         email,
         name,
         avatar_url,
         is_active,
         is_admin,
         last_login_at,
         created_at,
         updated_at
       FROM users
       WHERE deleted_at IS NULL
       ORDER BY ${orderColumn} ${orderDirection}
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
       is_admin,
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
       is_admin,
       last_login_at,
       created_at,
       updated_at`,
    [...values, userId]
  );

  return result.rows[0] ?? null;
}

export async function setUserActiveStatus(userId: string, isActive: boolean) {
  const result = await pool.query<UserRow>(
    `UPDATE users
     SET is_active = $1, updated_at = NOW()
     WHERE id = $2
       AND deleted_at IS NULL
     RETURNING
       id,
       email,
       name,
       avatar_url,
       is_active,
       is_admin,
       last_login_at,
       created_at,
       updated_at`,
    [isActive, userId]
  );

  return result.rows[0] ?? null;
}

export async function resetUserProjectRoles(userId: string, projectId?: string) {
  const result = await pool.query<{ project_id: string }>(
    `DELETE FROM project_team
     WHERE user_id = $1
       AND ($2::uuid IS NULL OR project_id = $2::uuid)
     RETURNING project_id`,
    [userId, projectId ?? null]
  );

  return {
    removedCount: result.rowCount,
    projectIds: result.rows.map((row) => row.project_id)
  };
}

export async function listAuditLogs(input: {
  userId?: string;
  projectId?: string;
  action?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  sortBy?: "createdAt" | "action";
  sortOrder?: "asc" | "desc";
}) {
  const sortBy = input.sortBy ?? "createdAt";
  const sortOrder = input.sortOrder ?? "desc";
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const orderColumnMap: Record<"createdAt" | "action", string> = {
    createdAt: "a.created_at",
    action: "a.action"
  };
  const orderColumn = orderColumnMap[sortBy];
  const orderDirection = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

  const where: string[] = ["1=1"];
  const values: Array<string> = [];

  if (input.userId) {
    values.push(input.userId);
    where.push(`a.user_id = $${values.length}`);
  }
  if (input.projectId) {
    values.push(input.projectId);
    where.push(`a.project_id = $${values.length}`);
  }
  if (input.action) {
    values.push(input.action);
    where.push(`a.action = $${values.length}`);
  }
  if (input.search) {
    values.push(`%${input.search}%`);
    where.push(
      `(a.action ILIKE $${values.length}
        OR COALESCE(u.name, '') ILIKE $${values.length}
        OR COALESCE(u.email, '') ILIKE $${values.length}
        OR COALESCE(a.project_id::text, '') ILIKE $${values.length}
        OR COALESCE(a.details::text, '') ILIKE $${values.length})`
    );
  }
  if (input.from) {
    values.push(input.from);
    where.push(`a.created_at >= $${values.length}::timestamptz`);
  }
  if (input.to) {
    values.push(input.to);
    where.push(`a.created_at <= $${values.length}::timestamptz`);
  }

  const [dataResult, countResult] = await Promise.all([
    pool.query<AuditLogRow>(
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
       WHERE ${where.join(" AND ")}
       ORDER BY ${orderColumn} ${orderDirection}
       LIMIT $${values.length + 1}
       OFFSET $${values.length + 2}`,
      [...values, pageSize.toString(), offset.toString()]
    ),
    pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM activity_log a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE ${where.join(" AND ")}`,
      values
    )
  ]);

  return {
    rows: dataResult.rows,
    total: Number(countResult.rows[0]?.total ?? 0)
  };
}
