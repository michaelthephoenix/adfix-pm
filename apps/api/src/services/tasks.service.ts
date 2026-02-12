import { pool } from "../db/pool.js";

export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked";
export type ProjectPhase =
  | "client_acquisition"
  | "strategy_planning"
  | "production"
  | "post_production"
  | "delivery";
export type PriorityLevel = "low" | "medium" | "high" | "urgent";

type TaskRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  phase: ProjectPhase;
  status: TaskStatus;
  priority: PriorityLevel;
  assigned_to: string | null;
  due_date: string | null;
  completed_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
};

type ListTasksFilter = {
  projectId?: string;
  assignedTo?: string;
  status?: TaskStatus;
  phase?: ProjectPhase;
  overdue?: boolean;
  page?: number;
  pageSize?: number;
};

const TASK_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["in_progress"],
  in_progress: ["completed", "blocked"],
  blocked: ["in_progress"],
  completed: []
};

type TaskTransitionResult =
  | { ok: true; task: TaskRow }
  | { ok: false; reason: "not_found" | "invalid_transition" };

export async function listTasks(filter: ListTasksFilter) {
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

  const where: string[] = ["t.deleted_at IS NULL"];
  const values: Array<string> = [];

  if (filter.projectId) {
    values.push(filter.projectId);
    where.push(`t.project_id = $${values.length}`);
  }
  if (filter.assignedTo) {
    values.push(filter.assignedTo);
    where.push(`t.assigned_to = $${values.length}`);
  }
  if (filter.status) {
    values.push(filter.status);
    where.push(`t.status = $${values.length}`);
  }
  if (filter.phase) {
    values.push(filter.phase);
    where.push(`t.phase = $${values.length}`);
  }
  if (filter.overdue === true) {
    where.push(`t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE AND t.status <> 'completed'`);
  }
  if (filter.overdue === false) {
    where.push(
      `(t.due_date IS NULL OR t.due_date >= CURRENT_DATE OR t.status = 'completed')`
    );
  }

  const dataQuery = `SELECT
       t.id,
       t.project_id,
       t.title,
       t.description,
       t.phase,
       t.status,
       t.priority,
       t.assigned_to,
       t.due_date,
       t.completed_at,
       t.created_by,
       t.created_at,
       t.updated_at
     FROM tasks t
     WHERE ${where.join(" AND ")}
     ORDER BY t.created_at DESC
     LIMIT $${values.length + 1}
     OFFSET $${values.length + 2}`;

  const countQuery = `SELECT COUNT(*)::text AS total
     FROM tasks t
     WHERE ${where.join(" AND ")}`;

  const [dataResult, countResult] = await Promise.all([
    pool.query<TaskRow>(dataQuery, [...values, pageSize.toString(), offset.toString()]),
    pool.query<{ total: string }>(countQuery, values)
  ]);

  return {
    rows: dataResult.rows,
    total: Number(countResult.rows[0]?.total ?? 0)
  };
}

export async function getTaskById(taskId: string) {
  const result = await pool.query<TaskRow>(
    `SELECT
       t.id,
       t.project_id,
       t.title,
       t.description,
       t.phase,
       t.status,
       t.priority,
       t.assigned_to,
       t.due_date,
       t.completed_at,
       t.created_by,
       t.created_at,
       t.updated_at
     FROM tasks t
     WHERE t.id = $1 AND t.deleted_at IS NULL
     LIMIT 1`,
    [taskId]
  );

  return result.rows[0] ?? null;
}

export async function createTask(input: {
  projectId: string;
  title: string;
  description?: string | null;
  phase: ProjectPhase;
  status?: TaskStatus;
  priority?: PriorityLevel;
  assignedTo?: string | null;
  dueDate?: string | null;
  createdBy: string;
}) {
  const result = await pool.query<TaskRow>(
    `INSERT INTO tasks (
       project_id, title, description, phase, status, priority,
       assigned_to, due_date, completed_at, created_by, created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5::task_status, $6,
       $7, $8::date, CASE WHEN $5::task_status = 'completed' THEN NOW() ELSE NULL END, $9, NOW(), NOW()
     )
     RETURNING
       id, project_id, title, description, phase, status, priority,
       assigned_to, due_date, completed_at, created_by, created_at, updated_at`,
    [
      input.projectId,
      input.title,
      input.description ?? null,
      input.phase,
      input.status ?? "pending",
      input.priority ?? "medium",
      input.assignedTo ?? null,
      input.dueDate ?? null,
      input.createdBy
    ]
  );

  return result.rows[0];
}

export async function updateTask(
  taskId: string,
  input: {
    projectId?: string;
    title?: string;
    description?: string | null;
    phase?: ProjectPhase;
    priority?: PriorityLevel;
    assignedTo?: string | null;
    dueDate?: string | null;
  }
) {
  const fields: string[] = [];
  const values: Array<string | null> = [];

  if (typeof input.projectId !== "undefined") {
    fields.push(`project_id = $${fields.length + 1}`);
    values.push(input.projectId);
  }
  if (typeof input.title !== "undefined") {
    fields.push(`title = $${fields.length + 1}`);
    values.push(input.title);
  }
  if (typeof input.description !== "undefined") {
    fields.push(`description = $${fields.length + 1}`);
    values.push(input.description);
  }
  if (typeof input.phase !== "undefined") {
    fields.push(`phase = $${fields.length + 1}`);
    values.push(input.phase);
  }
  if (typeof input.priority !== "undefined") {
    fields.push(`priority = $${fields.length + 1}`);
    values.push(input.priority);
  }
  if (typeof input.assignedTo !== "undefined") {
    fields.push(`assigned_to = $${fields.length + 1}`);
    values.push(input.assignedTo);
  }
  if (typeof input.dueDate !== "undefined") {
    fields.push(`due_date = $${fields.length + 1}::date`);
    values.push(input.dueDate);
  }

  if (fields.length === 0) {
    return getTaskById(taskId);
  }

  fields.push("updated_at = NOW()");

  const result = await pool.query<TaskRow>(
    `UPDATE tasks
     SET ${fields.join(", ")}
     WHERE id = $${fields.length} AND deleted_at IS NULL
     RETURNING
       id, project_id, title, description, phase, status, priority,
       assigned_to, due_date, completed_at, created_by, created_at, updated_at`,
    [...values, taskId]
  );

  return result.rows[0] ?? null;
}

export async function deleteTask(taskId: string) {
  const result = await pool.query<{ id: string }>(
    `UPDATE tasks
     SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [taskId]
  );

  return result.rowCount === 1;
}

export async function transitionTaskStatus(input: {
  taskId: string;
  nextStatus: TaskStatus;
}): Promise<TaskTransitionResult> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingTaskQuery = await client.query<TaskRow>(
      `SELECT
         id, project_id, title, description, phase, status, priority,
         assigned_to, due_date, completed_at, created_by, created_at, updated_at
       FROM tasks
       WHERE id = $1 AND deleted_at IS NULL
       FOR UPDATE`,
      [input.taskId]
    );

    const existingTask = existingTaskQuery.rows[0];
    if (!existingTask) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }

    const allowedNext = TASK_STATUS_TRANSITIONS[existingTask.status];
    if (!allowedNext.includes(input.nextStatus)) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "invalid_transition" };
    }

    const updatedTaskQuery = await client.query<TaskRow>(
      `UPDATE tasks
       SET
         status = $1::task_status,
         completed_at = CASE
           WHEN $1::task_status = 'completed' THEN NOW()
           ELSE NULL
         END,
         updated_at = NOW()
       WHERE id = $2
       RETURNING
         id, project_id, title, description, phase, status, priority,
         assigned_to, due_date, completed_at, created_by, created_at, updated_at`,
      [input.nextStatus, input.taskId]
    );

    await client.query("COMMIT");

    return { ok: true, task: updatedTaskQuery.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
