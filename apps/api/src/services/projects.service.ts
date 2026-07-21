import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import { resolveProjectActionNotifications } from "./notifications.service.js";
import type { ProjectRole } from "./rbac.service.js";

type ProjectRow = {
  id: string;
  client_id: string;
  name: string;
  description: string | null;
  current_phase: "client_acquisition" | "strategy_planning" | "production" | "post_production" | "delivery";
  priority: "low" | "medium" | "high" | "urgent";
  budget: string | null;
  start_date: string;
  deadline: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
};

type AccessibleProjectRow = ProjectRow & {
  client_name: string;
  current_user_role: ProjectRole | null;
};

type ListProjectsFilter = {
  clientId?: string;
  phase?: ProjectRow["current_phase"];
  priority?: ProjectRow["priority"];
  deadlineFrom?: string;
  deadlineTo?: string;
  page?: number;
  pageSize?: number;
  sortBy?: "createdAt" | "updatedAt" | "deadline" | "name" | "priority";
  sortOrder?: "asc" | "desc";
};

const PHASE_FLOW: Array<ProjectRow["current_phase"]> = [
  "client_acquisition",
  "strategy_planning",
  "production",
  "post_production",
  "delivery"
];

const PHASE_DEFAULT_TASK_TITLES: Record<ProjectRow["current_phase"], string[]> = {
  client_acquisition: ["Confirm client requirements", "Collect intake documents"],
  strategy_planning: ["Create project strategy", "Draft creative brief", "Approve production scope"],
  production: ["Produce core assets", "Internal quality check", "Prepare draft delivery"],
  post_production: ["Collect feedback", "Apply final revisions", "Finalize master files"],
  delivery: ["Package deliverables", "Deliver to client", "Close project handoff"]
};

type TransitionResult =
  | {
      ok: true;
      project: ProjectRow & { client_name: string };
      warnings: { unresolvedReviews: number; incompleteTasks: number };
    }
  | {
      ok: false;
      reason: "not_found" | "invalid_transition" | "delivery_confirmation_required";
      unresolvedReviews?: number;
      incompleteTasks?: number;
    };

export class ProjectClientLockedError extends Error {
  constructor() {
    super("The client cannot be changed after work has been submitted for client review");
    this.name = "ProjectClientLockedError";
  }
}

type ProjectDetail = ProjectRow & {
  client_name: string;
  current_user_role: ProjectRole | null;
  task_summary: {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    blocked: number;
    overdue: number;
  };
};

type ProjectTeamRow = {
  project_id: string;
  user_id: string;
  role: string;
  created_at: Date;
  user_name: string;
  user_email: string;
  assigned_task_count: string;
  open_task_count: string;
  overdue_task_count: string;
};

type ProjectTeamMutationResult =
  | { ok: true; member?: ProjectTeamRow }
  | { ok: false; reason: "not_found" | "assigned_tasks" | "last_supervisor" };

export type ProjectDeletionResult =
  | { ok: true; localObjectKeys: string[] }
  | { ok: false; reason: "not_found" | "delivery_locked" | "deliverable_history_exists" };

export async function listProjects(filter: ListProjectsFilter, userId: string) {
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const sortBy = filter.sortBy ?? "createdAt";
  const sortOrder = filter.sortOrder ?? "desc";
  const orderColumnMap: Record<NonNullable<ListProjectsFilter["sortBy"]>, string> = {
    createdAt: "p.created_at",
    updatedAt: "p.updated_at",
    deadline: "p.deadline",
    name: "p.name",
    priority: "p.priority"
  };
  const orderColumn = orderColumnMap[sortBy];
  const orderDirection = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

  const where: string[] = [
    "p.deleted_at IS NULL",
    "(p.created_by = $1 OR pt.user_id IS NOT NULL)"
  ];
  const values: Array<string> = [userId];

  if (filter.clientId) {
    values.push(filter.clientId);
    where.push(`p.client_id = $${values.length}`);
  }
  if (filter.phase) {
    values.push(filter.phase);
    where.push(`p.current_phase = $${values.length}`);
  }
  if (filter.priority) {
    values.push(filter.priority);
    where.push(`p.priority = $${values.length}`);
  }
  if (filter.deadlineFrom) {
    values.push(filter.deadlineFrom);
    where.push(`p.deadline >= $${values.length}::date`);
  }
  if (filter.deadlineTo) {
    values.push(filter.deadlineTo);
    where.push(`p.deadline <= $${values.length}::date`);
  }

  const dataQuery = `
    SELECT
      p.id,
      p.client_id,
      c.name AS client_name,
      CASE
        WHEN p.created_by = $1 THEN 'owner'
        WHEN pt.role IS NULL THEN NULL
        ELSE LOWER(pt.role)
      END AS current_user_role,
      p.name,
      p.description,
      p.current_phase,
      p.priority,
      p.budget,
      p.start_date,
      p.deadline,
      p.created_by,
      p.created_at,
      p.updated_at
    FROM projects p
    INNER JOIN clients c ON c.id = p.client_id AND c.deleted_at IS NULL
    LEFT JOIN project_team pt
      ON pt.project_id = p.id
     AND pt.user_id = $1
    WHERE ${where.join(" AND ")}
    ORDER BY ${orderColumn} ${orderDirection}
    LIMIT $${values.length + 1}
    OFFSET $${values.length + 2}
  `;

  const countQuery = `
    SELECT COUNT(*)::text AS total
    FROM projects p
    INNER JOIN clients c ON c.id = p.client_id AND c.deleted_at IS NULL
    LEFT JOIN project_team pt
      ON pt.project_id = p.id
     AND pt.user_id = $1
    WHERE ${where.join(" AND ")}
  `;

  const [dataResult, countResult] = await Promise.all([
    pool.query<AccessibleProjectRow>(dataQuery, [...values, pageSize.toString(), offset.toString()]),
    pool.query<{ total: string }>(countQuery, values)
  ]);

  return {
    rows: dataResult.rows,
    total: Number(countResult.rows[0]?.total ?? 0)
  };
}

export async function getProjectById(projectId: string) {
  const result = await pool.query<ProjectRow & { client_name: string }>(
    `SELECT
       p.id,
       p.client_id,
       c.name AS client_name,
       p.name,
       p.description,
       p.current_phase,
       p.priority,
       p.budget,
       p.start_date,
       p.deadline,
       p.created_by,
       p.created_at,
       p.updated_at
     FROM projects p
     INNER JOIN clients c ON c.id = p.client_id AND c.deleted_at IS NULL
     WHERE p.id = $1
       AND p.deleted_at IS NULL
     LIMIT 1`,
    [projectId]
  );

  return result.rows[0] ?? null;
}

export async function getProjectDetailById(projectId: string, userId: string): Promise<ProjectDetail | null> {
  const projectResult = await pool.query<AccessibleProjectRow>(
    `SELECT
       p.id,
       p.client_id,
       c.name AS client_name,
       CASE
         WHEN p.created_by = $2 THEN 'owner'
         WHEN pt.role IS NULL THEN NULL
         ELSE LOWER(pt.role)
       END AS current_user_role,
       p.name,
       p.description,
       p.current_phase,
       p.priority,
       p.budget,
       p.start_date,
       p.deadline,
       p.created_by,
       p.created_at,
       p.updated_at
     FROM projects p
     INNER JOIN clients c ON c.id = p.client_id AND c.deleted_at IS NULL
     LEFT JOIN project_team pt
       ON pt.project_id = p.id
      AND pt.user_id = $2
     WHERE p.id = $1
       AND p.deleted_at IS NULL
     LIMIT 1`,
    [projectId, userId]
  );

  const project = projectResult.rows[0];
  if (!project) return null;

  const summaryResult = await pool.query<{
    total: string;
    pending: string;
    in_progress: string;
    completed: string;
    blocked: string;
    overdue: string;
  }>(
    `SELECT
       COUNT(*)::int::text AS total,
       COUNT(*) FILTER (WHERE status = 'pending')::int::text AS pending,
       COUNT(*) FILTER (WHERE status = 'in_progress')::int::text AS in_progress,
       COUNT(*) FILTER (WHERE status = 'completed')::int::text AS completed,
       COUNT(*) FILTER (WHERE status = 'blocked')::int::text AS blocked,
       COUNT(*) FILTER (
         WHERE due_date IS NOT NULL
           AND due_date < CURRENT_DATE
           AND status <> 'completed'
       )::int::text AS overdue
     FROM tasks
     WHERE project_id = $1
       AND deleted_at IS NULL`,
    [projectId]
  );

  const summary = summaryResult.rows[0];

  return {
    ...project,
    task_summary: {
      total: Number(summary.total),
      pending: Number(summary.pending),
      in_progress: Number(summary.in_progress),
      completed: Number(summary.completed),
      blocked: Number(summary.blocked),
      overdue: Number(summary.overdue)
    }
  };
}

export async function createProject(input: {
  clientId: string;
  name: string;
  description?: string | null;
  currentPhase?: ProjectRow["current_phase"];
  priority?: ProjectRow["priority"];
  budget?: string | null;
  startDate: string;
  deadline: string;
  createdBy: string;
}) {
  const result = await pool.query<ProjectRow>(
    `INSERT INTO projects (
       client_id, name, description, current_phase, priority, budget, start_date, deadline, created_by, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, NULLIF($6, '')::numeric, $7::date, $8::date, $9, NOW(), NOW())
     RETURNING
       id, client_id, name, description, current_phase, priority, budget, start_date, deadline, created_by, created_at, updated_at`,
    [
      input.clientId,
      input.name,
      input.description ?? null,
      input.currentPhase ?? "client_acquisition",
      input.priority ?? "medium",
      input.budget ?? null,
      input.startDate,
      input.deadline,
      input.createdBy
    ]
  );

  return result.rows[0];
}

export async function updateProject(
  projectId: string,
  input: {
    clientId?: string;
    name?: string;
    description?: string | null;
    currentPhase?: ProjectRow["current_phase"];
    priority?: ProjectRow["priority"];
    budget?: string | null;
    startDate?: string;
    deadline?: string;
  }
) {
  const fields: string[] = [];
  const values: Array<string | null> = [];

  if (typeof input.clientId !== "undefined") {
    fields.push(`client_id = $${fields.length + 1}`);
    values.push(input.clientId);
  }
  if (typeof input.name !== "undefined") {
    fields.push(`name = $${fields.length + 1}`);
    values.push(input.name);
  }
  if (typeof input.description !== "undefined") {
    fields.push(`description = $${fields.length + 1}`);
    values.push(input.description);
  }
  if (typeof input.currentPhase !== "undefined") {
    fields.push(`current_phase = $${fields.length + 1}`);
    values.push(input.currentPhase);
  }
  if (typeof input.priority !== "undefined") {
    fields.push(`priority = $${fields.length + 1}`);
    values.push(input.priority);
  }
  if (typeof input.budget !== "undefined") {
    fields.push(`budget = NULLIF($${fields.length + 1}, '')::numeric`);
    values.push(input.budget);
  }
  if (typeof input.startDate !== "undefined") {
    fields.push(`start_date = $${fields.length + 1}::date`);
    values.push(input.startDate);
  }
  if (typeof input.deadline !== "undefined") {
    fields.push(`deadline = $${fields.length + 1}::date`);
    values.push(input.deadline);
  }

  if (fields.length === 0) {
    return getProjectById(projectId);
  }

  fields.push("updated_at = NOW()");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ client_id: string }>(
      `SELECT client_id FROM projects
       WHERE id = $1 AND deleted_at IS NULL
       FOR UPDATE`,
      [projectId]
    );
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }

    if (input.clientId && input.clientId !== current.rows[0].client_id) {
      const clientHistory = await client.query<{ locked: boolean }>(
        `SELECT (
           EXISTS (
             SELECT 1
             FROM deliverables deliverable
             INNER JOIN deliverable_versions version ON version.deliverable_id = deliverable.id
             WHERE deliverable.project_id = $1
               AND (
                 version.client_submitted_at IS NOT NULL
                 OR EXISTS (
                   SELECT 1 FROM deliverable_reviews review
                   WHERE review.deliverable_version_id = version.id
                 )
               )
           )
           OR EXISTS (
             SELECT 1 FROM activity_log
             WHERE project_id = $1 AND action = 'deliverable_submitted_to_client'
           )
         ) AS locked`,
        [projectId]
      );
      if (clientHistory.rows[0]?.locked) throw new ProjectClientLockedError();
    }

    const result = await client.query<ProjectRow>(
      `UPDATE projects
       SET ${fields.join(", ")}
       WHERE id = $${fields.length} AND deleted_at IS NULL
       RETURNING
         id, client_id, name, description, current_phase, priority, budget, start_date, deadline, created_by, created_at, updated_at`,
      [...values, projectId]
    );
    await client.query("COMMIT");
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteProject(projectId: string, userId: string): Promise<ProjectDeletionResult> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const projectState = await client.query<{ id: string; current_phase: ProjectRow["current_phase"]; deliverable_history_exists: boolean }>(
      `SELECT project.id, project.current_phase,
         EXISTS (
           SELECT 1
           FROM deliverables deliverable
           INNER JOIN deliverable_versions version ON version.deliverable_id = deliverable.id
           WHERE deliverable.project_id = project.id
         ) AS deliverable_history_exists
       FROM projects project
       WHERE project.id = $1
         AND project.created_by = $2
         AND project.deleted_at IS NULL
       FOR UPDATE`,
      [projectId, userId]
    );
    const state = projectState.rows[0];
    if (!state) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }
    if (state.current_phase === "delivery") {
      await client.query("ROLLBACK");
      return { ok: false, reason: "delivery_locked" };
    }
    if (state.deliverable_history_exists) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "deliverable_history_exists" };
    }

    const localFiles = await client.query<{ object_key: string }>(
      `SELECT object_key
       FROM files
       WHERE project_id = $1
         AND storage_type = 'local'
         AND deleted_at IS NULL`,
      [projectId]
    );

    const projectResult = await client.query<{ id: string }>(
      `UPDATE projects
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1
         AND created_by = $2
         AND deleted_at IS NULL
       RETURNING id`,
      [projectId, userId]
    );

    if (projectResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }

    await client.query(
      `UPDATE tasks
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE project_id = $1
         AND deleted_at IS NULL`,
      [projectId]
    );

    await client.query(
      `UPDATE files
       SET deleted_at = NOW()
       WHERE project_id = $1
         AND deleted_at IS NULL`,
      [projectId]
    );

    await client.query(
      `DELETE FROM project_team
       WHERE project_id = $1`,
      [projectId]
    );

    await client.query("COMMIT");
    return { ok: true, localObjectKeys: localFiles.rows.map((file) => file.object_key) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function transitionProjectPhase(input: {
  projectId: string;
  nextPhase: ProjectRow["current_phase"];
  userId: string;
  reason?: string | null;
  clientUpdate?: string | null;
  confirmUnresolvedReviews?: boolean;
}): Promise<TransitionResult> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const projectQuery = await client.query<ProjectRow>(
      `SELECT
         id, client_id, name, description, current_phase, priority, budget,
         start_date, deadline, created_by, created_at, updated_at
       FROM projects
       WHERE id = $1 AND deleted_at IS NULL
       FOR UPDATE`,
      [input.projectId]
    );

    const project = projectQuery.rows[0];
    if (!project) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }

    const currentIndex = PHASE_FLOW.indexOf(project.current_phase);
    const nextIndex = PHASE_FLOW.indexOf(input.nextPhase);

    if (nextIndex !== currentIndex + 1) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "invalid_transition" };
    }

    const unresolvedReviewResult = input.nextPhase === "delivery"
      ? await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM deliverables
           WHERE project_id = $1
             AND deleted_at IS NULL
             AND status IN (
               'internal_review', 'internal_changes_requested', 'internal_approved',
               'in_review', 'changes_requested'
             )`,
          [input.projectId]
        )
      : { rows: [{ count: "0" }] };
    const unresolvedReviews = Number(unresolvedReviewResult.rows[0]?.count ?? 0);
    const incompleteTaskResult = input.nextPhase === "delivery"
      ? await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM tasks
           WHERE project_id = $1 AND deleted_at IS NULL AND status <> 'completed'`,
          [input.projectId]
        )
      : { rows: [{ count: "0" }] };
    const incompleteTasks = Number(incompleteTaskResult.rows[0]?.count ?? 0);

    const hasDeliveryWarnings = unresolvedReviews > 0 || incompleteTasks > 0;
    if (input.nextPhase === "delivery" && hasDeliveryWarnings && input.confirmUnresolvedReviews !== true) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        reason: "delivery_confirmation_required",
        unresolvedReviews,
        incompleteTasks
      };
    }

    await client.query(
      `UPDATE projects
       SET current_phase = $1, updated_at = NOW()
       WHERE id = $2`,
      [input.nextPhase, input.projectId]
    );

    // Create default tasks for the next phase, skipping titles that already exist (idempotent behavior).
    const templateTitles = PHASE_DEFAULT_TASK_TITLES[input.nextPhase] ?? [];
    if (templateTitles.length > 0) {
      const existingTaskRows = await client.query<{ title: string }>(
        `SELECT title
         FROM tasks
         WHERE project_id = $1
           AND phase = $2
           AND deleted_at IS NULL`,
        [input.projectId, input.nextPhase]
      );

      const existingTitles = new Set(existingTaskRows.rows.map((row) => row.title.trim().toLowerCase()));
      const missingTitles = templateTitles.filter(
        (title) => !existingTitles.has(title.trim().toLowerCase())
      );

      for (const title of missingTitles) {
        await client.query(
          `INSERT INTO tasks (
             project_id, title, description, phase, status, priority, assigned_to,
             due_date, completed_at, created_by, created_at, updated_at
           )
           VALUES (
             $1, $2, NULL, $3, 'pending', 'medium', NULL,
             NULL, NULL, $4, NOW(), NOW()
           )`,
          [input.projectId, title, input.nextPhase, input.userId]
        );
      }
    }

    await client.query(
      `INSERT INTO activity_log (project_id, user_id, action, details, client_visible, created_at)
       VALUES
         ($1, $2, 'project_phase_changed', $3::jsonb, FALSE, NOW()),
         ($1, $2, 'project_milestone_shared', $4::jsonb, TRUE, NOW())`,
      [
        input.projectId,
        input.userId,
        JSON.stringify({
          from: project.current_phase,
          to: input.nextPhase,
          reason: input.reason ?? null,
          unresolvedReviews,
          incompleteTasks,
          unresolvedReviewsConfirmed: input.nextPhase === "delivery" && unresolvedReviews > 0 && input.confirmUnresolvedReviews === true,
          warningsConfirmed: input.nextPhase === "delivery" && hasDeliveryWarnings && input.confirmUnresolvedReviews === true
        }),
        JSON.stringify({
          from: project.current_phase,
          to: input.nextPhase,
          update: input.clientUpdate ?? null
        })
      ]
    );

    if (input.nextPhase === "delivery") {
      await resolveProjectActionNotifications(input.projectId, "project_entered_delivery", client);
    }

    await client.query("COMMIT");

    const withClientName = await pool.query<ProjectRow & { client_name: string }>(
      `SELECT
         p.id,
         p.client_id,
         c.name AS client_name,
         p.name,
         p.description,
         p.current_phase,
         p.priority,
         p.budget,
         p.start_date,
         p.deadline,
         p.created_by,
         p.created_at,
         p.updated_at
       FROM projects p
       INNER JOIN clients c ON c.id = p.client_id AND c.deleted_at IS NULL
       WHERE p.id = $1
       LIMIT 1`,
      [input.projectId]
    );

    return {
      ok: true,
      project: withClientName.rows[0],
      warnings: { unresolvedReviews, incompleteTasks }
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listProjectTeamMembers(projectId: string) {
  const result = await pool.query<ProjectTeamRow>(
    `SELECT team.project_id, team.user_id, team.role, team.created_at,
       team.user_name, team.user_email,
       (
         SELECT COUNT(*)::text
         FROM task_assignees assignee
         INNER JOIN tasks task ON task.id = assignee.task_id AND task.deleted_at IS NULL
         WHERE task.project_id = team.project_id AND assignee.user_id = team.user_id
       ) AS assigned_task_count,
       (
         SELECT COUNT(*)::text
         FROM task_assignees assignee
         INNER JOIN tasks task ON task.id = assignee.task_id AND task.deleted_at IS NULL
         WHERE task.project_id = team.project_id
           AND assignee.user_id = team.user_id
           AND task.status <> 'completed'
       ) AS open_task_count,
       (
         SELECT COUNT(*)::text
         FROM task_assignees assignee
         INNER JOIN tasks task ON task.id = assignee.task_id AND task.deleted_at IS NULL
         WHERE task.project_id = team.project_id
           AND assignee.user_id = team.user_id
           AND task.status <> 'completed'
           AND task.due_date < CURRENT_DATE
       ) AS overdue_task_count
     FROM (
       SELECT project.id AS project_id, owner.id AS user_id, 'owner'::text AS role,
         project.created_at, owner.name AS user_name, owner.email::text AS user_email
       FROM projects project
       INNER JOIN users owner
         ON owner.id = project.created_by
        AND owner.account_type = 'staff'
        AND owner.is_active = TRUE
        AND owner.deleted_at IS NULL
       WHERE project.id = $1 AND project.deleted_at IS NULL
       UNION ALL
       SELECT membership.project_id, member.id AS user_id, membership.role,
         membership.created_at, member.name AS user_name, member.email::text AS user_email
       FROM project_team membership
       INNER JOIN projects project ON project.id = membership.project_id AND project.deleted_at IS NULL
       INNER JOIN users member
         ON member.id = membership.user_id
        AND member.account_type = 'staff'
        AND member.is_active = TRUE
        AND member.deleted_at IS NULL
       WHERE membership.project_id = $1 AND membership.user_id <> project.created_by
     ) team
     ORDER BY CASE WHEN team.role = 'owner' THEN 0 ELSE 1 END, team.created_at ASC`,
    [projectId]
  );

  return result.rows;
}

async function countActiveProjectSupervisors(client: PoolClient, projectId: string) {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(DISTINCT supervisor.user_id)::text AS count
     FROM (
       SELECT project.created_by AS user_id
       FROM projects project
       INNER JOIN users owner
         ON owner.id = project.created_by
        AND owner.account_type = 'staff'
        AND owner.is_active = TRUE
        AND owner.deleted_at IS NULL
       WHERE project.id = $1 AND project.deleted_at IS NULL
       UNION
       SELECT membership.user_id
       FROM project_team membership
       INNER JOIN users manager
         ON manager.id = membership.user_id
        AND manager.account_type = 'staff'
        AND manager.is_active = TRUE
        AND manager.deleted_at IS NULL
       WHERE membership.project_id = $1 AND LOWER(membership.role) = 'manager'
     ) supervisor`,
    [projectId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function updateProjectTeamMemberRole(input: {
  projectId: string;
  userId: string;
  role: "manager" | "member" | "viewer";
}): Promise<ProjectTeamMutationResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const membership = await client.query<{ role: string }>(
      `SELECT role FROM project_team
       WHERE project_id = $1 AND user_id = $2
       FOR UPDATE`,
      [input.projectId, input.userId]
    );
    const existing = membership.rows[0];
    if (!existing) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }
    if (existing.role.toLowerCase() === "manager" && input.role !== "manager") {
      const supervisorCount = await countActiveProjectSupervisors(client, input.projectId);
      if (supervisorCount <= 1) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "last_supervisor" };
      }
    }
    await client.query(
      "UPDATE project_team SET role = $1 WHERE project_id = $2 AND user_id = $3",
      [input.role, input.projectId, input.userId]
    );
    await client.query("COMMIT");
    const member = (await listProjectTeamMembers(input.projectId)).find((row) => row.user_id === input.userId);
    return member ? { ok: true, member } : { ok: false, reason: "not_found" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function addProjectTeamMember(input: {
  projectId: string;
  userId: string;
  role: string;
}) {
  const projectExists = await pool.query<{ id: string }>(
    `SELECT id FROM projects WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [input.projectId]
  );
  if (projectExists.rowCount === 0) return { ok: false as const, reason: "project_not_found" as const };

  const userExists = await pool.query<{ id: string }>(
    `SELECT id FROM users
     WHERE id = $1
       AND account_type = 'staff'
       AND deleted_at IS NULL
       AND is_active = TRUE
     LIMIT 1`,
    [input.userId]
  );
  if (userExists.rowCount === 0) return { ok: false as const, reason: "user_not_found" as const };

  const result = await pool.query<ProjectTeamRow>(
    `INSERT INTO project_team (project_id, user_id, role, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (project_id, user_id)
     DO UPDATE SET role = EXCLUDED.role
     RETURNING project_id, user_id, role, created_at,
       (SELECT name FROM users WHERE id = project_team.user_id) AS user_name,
       (SELECT email FROM users WHERE id = project_team.user_id) AS user_email,
       '0'::text AS assigned_task_count,
       '0'::text AS open_task_count,
       '0'::text AS overdue_task_count`,
    [input.projectId, input.userId, input.role]
  );

  return { ok: true as const, member: result.rows[0] };
}

export async function removeProjectTeamMember(projectId: string, userId: string): Promise<ProjectTeamMutationResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const membership = await client.query<{ project_id: string; user_id: string; role: string }>(
      `SELECT project_id, user_id, role FROM project_team
       WHERE project_id = $1 AND user_id = $2
       FOR UPDATE`,
      [projectId, userId]
    );
    if (!membership.rows[0]) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "not_found" as const };
    }

    if (membership.rows[0].role.toLowerCase() === "manager") {
      const supervisorCount = await countActiveProjectSupervisors(client, projectId);
      if (supervisorCount <= 1) {
        await client.query("ROLLBACK");
        return { ok: false as const, reason: "last_supervisor" as const };
      }
    }

    const assignment = await client.query<{ assigned: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM task_assignees assignee
         INNER JOIN tasks task ON task.id = assignee.task_id AND task.deleted_at IS NULL
         WHERE task.project_id = $1 AND assignee.user_id = $2
       ) AS assigned`,
      [projectId, userId]
    );
    if (assignment.rows[0]?.assigned) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "assigned_tasks" as const };
    }

    await client.query(
      "DELETE FROM project_team WHERE project_id = $1 AND user_id = $2",
      [projectId, userId]
    );
    await client.query("COMMIT");
    return { ok: true as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
