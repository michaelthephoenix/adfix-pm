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
};

const PHASE_FLOW: Array<ProjectRow["current_phase"]> = [
  "client_acquisition",
  "strategy_planning",
  "production",
  "post_production",
  "delivery"
];

type TransitionResult =
  | { ok: true; project: ProjectRow & { client_name: string } }
  | { ok: false; reason: "not_found" | "invalid_transition" };

export async function listProjects(filter: ListProjectsFilter) {
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

  const query = `
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
  `;

  const result = await pool.query<ProjectRow & { client_name: string }>(query, values);
  return result.rows;
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
  const result = await pool.query<{ id: string }>(
    `UPDATE projects
     SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1
       AND created_by = $2
       AND deleted_at IS NULL
     RETURNING id`,
    [projectId, userId]
  );

  return result.rowCount === 1;
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
