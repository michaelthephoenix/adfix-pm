import { pool } from "../db/pool.js";

export type ProjectRole = "owner" | "manager" | "member" | "viewer";
export type ProjectPermission =
  | "project:view"
  | "project:update"
  | "project:delete"
  | "team:manage"
  | "task:write"
  | "file:write"
  | "deliverable:supervise";

type ProjectAccessRow = {
  created_by: string;
  team_role: string | null;
};

const PERMISSION_MATRIX: Record<ProjectRole, ProjectPermission[]> = {
  owner: ["project:view", "project:update", "project:delete", "team:manage", "task:write", "file:write", "deliverable:supervise"],
  manager: ["project:view", "project:update", "team:manage", "task:write", "file:write", "deliverable:supervise"],
  member: ["project:view", "task:write", "file:write"],
  viewer: ["project:view"]
};

function normalizeTeamRole(role: string): ProjectRole {
  const value = role.trim().toLowerCase();
  if (value === "manager" || value === "member" || value === "viewer") {
    return value;
  }

  // Backward-compatible fallback for legacy free-form labels such as "Designer".
  return "member";
}

async function getProjectRoleForUser(projectId: string, userId: string): Promise<ProjectRole | null> {
  const result = await pool.query<ProjectAccessRow>(
    `SELECT
       p.created_by,
       pt.role AS team_role
     FROM projects p
     INNER JOIN users actor
       ON actor.id = $2
      AND actor.account_type = 'staff'
      AND actor.is_active = TRUE
      AND actor.deleted_at IS NULL
     LEFT JOIN project_team pt
       ON pt.project_id = p.id
      AND pt.user_id = $2
     WHERE p.id = $1
       AND p.deleted_at IS NULL
     LIMIT 1`,
    [projectId, userId]
  );

  const row = result.rows[0];
  if (!row) return null;
  if (row.created_by === userId) return "owner";
  if (!row.team_role) return null;

  return normalizeTeamRole(row.team_role);
}

export async function hasProjectPermission(input: {
  projectId: string;
  userId: string;
  permission: ProjectPermission;
}) {
  const role = await getProjectRoleForUser(input.projectId, input.userId);
  if (!role) {
    return false;
  }

  return PERMISSION_MATRIX[role].includes(input.permission);
}
