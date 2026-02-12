import { pool } from "../db/pool.js";

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

type ListProjectsFilter = {
  clientId?: string;
  phase?: ProjectRow["current_phase"];
  priority?: ProjectRow["priority"];
  deadlineFrom?: string;
  deadlineTo?: string;
  page?: number;
  pageSize?: number;
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
  | { ok: true; project: ProjectRow & { client_name: string } }
  | { ok: false; reason: "not_found" | "invalid_transition" };

type ProjectDetail = ProjectRow & {
  client_name: string;
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
};

export async function listProjects(filter: ListProjectsFilter) {
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const where: string[] = ["p.deleted_at IS NULL"];
  const values: Array<string> = [];

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
    WHERE ${where.join(" AND ")}
    ORDER BY p.created_at DESC
    LIMIT $${values.length + 1}
    OFFSET $${values.length + 2}
  `;

  const countQuery = `
    SELECT COUNT(*)::text AS total
    FROM projects p
    INNER JOIN clients c ON c.id = p.client_id AND c.deleted_at IS NULL
    WHERE ${where.join(" AND ")}
  `;

  const [dataResult, countResult] = await Promise.all([
    pool.query<ProjectRow & { client_name: string }>(dataQuery, [...values, pageSize.toString(), offset.toString()]),
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

export async function getProjectDetailById(projectId: string): Promise<ProjectDetail | null> {
  const projectResult = await pool.query<ProjectRow & { client_name: string }>(
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

  const result = await pool.query<ProjectRow>(
    `UPDATE projects
     SET ${fields.join(", ")}
     WHERE id = $${fields.length} AND deleted_at IS NULL
     RETURNING
       id, client_id, name, description, current_phase, priority, budget, start_date, deadline, created_by, created_at, updated_at`,
    [...values, projectId]
  );

  return result.rows[0] ?? null;
}

export async function deleteProject(projectId: string, userId: string) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

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
      return false;
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
    return true;
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

    const updatedQuery = await client.query<ProjectRow>(
      `UPDATE projects
       SET current_phase = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING
         id, client_id, name, description, current_phase, priority, budget,
         start_date, deadline, created_by, created_at, updated_at`,
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
      `INSERT INTO activity_log (project_id, user_id, action, details, created_at)
       VALUES ($1, $2, $3, $4::jsonb, NOW())`,
      [
        input.projectId,
        input.userId,
        "project_phase_changed",
        JSON.stringify({
          from: project.current_phase,
          to: input.nextPhase,
          reason: input.reason ?? null
        })
      ]
    );

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

    return { ok: true, project: withClientName.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listProjectTeamMembers(projectId: string) {
  const result = await pool.query<ProjectTeamRow>(
    `SELECT
       pt.project_id,
       pt.user_id,
       pt.role,
       pt.created_at,
       u.name AS user_name,
       u.email AS user_email
     FROM project_team pt
     INNER JOIN users u ON u.id = pt.user_id AND u.deleted_at IS NULL
     WHERE pt.project_id = $1
     ORDER BY pt.created_at ASC`,
    [projectId]
  );

  return result.rows;
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
    `SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL AND is_active = TRUE LIMIT 1`,
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
       (SELECT email FROM users WHERE id = project_team.user_id) AS user_email`,
    [input.projectId, input.userId, input.role]
  );

  return { ok: true as const, member: result.rows[0] };
}

export async function removeProjectTeamMember(projectId: string, userId: string) {
  const result = await pool.query<{ project_id: string; user_id: string }>(
    `DELETE FROM project_team
     WHERE project_id = $1
       AND user_id = $2
     RETURNING project_id, user_id`,
    [projectId, userId]
  );

  return result.rowCount === 1;
}
