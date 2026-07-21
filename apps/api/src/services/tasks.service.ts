import { pool } from "../db/pool.js";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import {
  deliverQueuedNotificationEvent,
  enqueueNotificationEvent,
  resolveTaskActionNotifications
} from "./notifications.service.js";

export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked";
export type ProjectPhase =
  | "client_acquisition"
  | "strategy_planning"
  | "production"
  | "post_production"
  | "delivery";
export type PriorityLevel = "low" | "medium" | "high" | "urgent";

type TaskAssignee = {
  id: string;
  name: string;
  avatar_url: string | null;
};

type TaskLabel = {
  id: string;
  name: string;
  color: "violet" | "blue" | "green" | "amber" | "rose" | "slate";
};

type TaskDeliverable = {
  id: string;
  title: string;
  status: string;
  latest_version_id: string | null;
  latest_version_number: number | null;
};

export type TaskDeliverableSelection =
  | { mode: "existing"; deliverableId: string }
  | { mode: "new"; title: string; description?: string | null };

export class InvalidTaskDeliverableError extends Error {
  constructor() {
    super("The selected deliverable does not belong to this project");
    this.name = "InvalidTaskDeliverableError";
  }
}

export class InvalidTaskAssigneesError extends Error {
  constructor(public readonly invalidUserIds: string[]) {
    super("Task assignees must be active staff members on this project");
    this.name = "InvalidTaskAssigneesError";
  }
}

export class TaskProjectMoveConflictError extends Error {
  constructor() {
    super("A task linked to a deliverable cannot be moved to another project");
    this.name = "TaskProjectMoveConflictError";
  }
}

export class TaskDeliverableRequiredError extends Error {
  constructor() {
    super("Submit the linked deliverable for internal review to complete this task");
    this.name = "TaskDeliverableRequiredError";
  }
}

type TaskRow = {
  id: string;
  project_id: string;
  project_name?: string;
  title: string;
  description: string | null;
  phase: ProjectPhase;
  status: TaskStatus;
  priority: PriorityLevel;
  deliverable_required: boolean;
  assigned_to: string | null;
  due_date: string | null;
  completed_at: Date | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  assignees: TaskAssignee[];
  labels: TaskLabel[];
  deliverables: TaskDeliverable[];
};

type TaskLabelInput = Pick<TaskLabel, "name" | "color">;

function normalizeDateOnly(value: string | Date | null) {
  if (!value) return null;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return value.slice(0, 10);
}

async function assertEligibleTaskAssignees(
  client: PoolClient,
  input: { projectId: string; assigneeIds: string[] }
) {
  const assigneeIds = [...new Set(input.assigneeIds)];
  if (assigneeIds.length === 0) return;

  const eligible = await client.query<{ id: string }>(
    `SELECT member.id
     FROM users member
     INNER JOIN projects project ON project.id = $1 AND project.deleted_at IS NULL
     WHERE member.id = ANY($2::uuid[])
       AND member.account_type = 'staff'
       AND member.is_active = TRUE
       AND member.deleted_at IS NULL
       AND (
         project.created_by = member.id
         OR EXISTS (
           SELECT 1 FROM project_team team
           WHERE team.project_id = project.id
             AND team.user_id = member.id
             AND LOWER(team.role) IN ('manager', 'member')
         )
       )`,
    [input.projectId, assigneeIds]
  );
  const eligibleIds = new Set(eligible.rows.map((row) => row.id));
  const invalidUserIds = assigneeIds.filter((id) => !eligibleIds.has(id));
  if (invalidUserIds.length > 0) throw new InvalidTaskAssigneesError(invalidUserIds);
}

export async function validateTaskAssigneesForProject(input: {
  projectId: string;
  assigneeIds: string[];
}) {
  const client = await pool.connect();
  try {
    await assertEligibleTaskAssignees(client, input);
  } finally {
    client.release();
  }
}

async function hydrateTaskRelations(rows: TaskRow[]) {
  if (rows.length === 0) return rows;

  const taskIds = rows.map((row) => row.id);
  const [assigneeResult, labelResult, deliverableResult] = await Promise.all([
    pool.query<{ task_id: string; id: string; name: string; avatar_url: string | null }>(
      `SELECT ta.task_id, u.id, u.name, u.avatar_url
       FROM task_assignees ta
       JOIN users u ON u.id = ta.user_id
       WHERE ta.task_id = ANY($1::uuid[])
       ORDER BY ta.assigned_at ASC, u.name ASC`,
      [taskIds]
    ),
    pool.query<{ task_id: string; id: string; name: string; color: TaskLabel["color"] }>(
      `SELECT tla.task_id, label.id, label.name, label.color
       FROM task_label_assignments tla
       JOIN task_labels label ON label.id = tla.label_id
       WHERE tla.task_id = ANY($1::uuid[])
       ORDER BY lower(label.name) ASC`,
      [taskIds]
    ),
    pool.query<{
      task_id: string;
      id: string;
      title: string;
      status: string;
      latest_version_id: string | null;
      latest_version_number: number | null;
    }>(
      `SELECT dt.task_id, d.id, d.title, d.status,
         latest.id AS latest_version_id,
         latest.version_number AS latest_version_number
       FROM deliverable_tasks dt
       INNER JOIN deliverables d ON d.id = dt.deliverable_id AND d.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT dv.id, dv.version_number
         FROM deliverable_versions dv
         WHERE dv.deliverable_id = d.id
         ORDER BY dv.version_number DESC
         LIMIT 1
       ) latest ON TRUE
       WHERE dt.task_id = ANY($1::uuid[])
       ORDER BY d.created_at DESC`,
      [taskIds]
    )
  ]);

  const assigneesByTask = new Map<string, TaskAssignee[]>();
  for (const row of assigneeResult.rows) {
    const assignees = assigneesByTask.get(row.task_id) ?? [];
    assignees.push({ id: row.id, name: row.name, avatar_url: row.avatar_url });
    assigneesByTask.set(row.task_id, assignees);
  }

  const labelsByTask = new Map<string, TaskLabel[]>();
  for (const row of labelResult.rows) {
    const labels = labelsByTask.get(row.task_id) ?? [];
    labels.push({ id: row.id, name: row.name, color: row.color });
    labelsByTask.set(row.task_id, labels);
  }

  const deliverablesByTask = new Map<string, TaskDeliverable[]>();
  for (const row of deliverableResult.rows) {
    const deliverables = deliverablesByTask.get(row.task_id) ?? [];
    deliverables.push({
      id: row.id,
      title: row.title,
      status: row.status,
      latest_version_id: row.latest_version_id,
      latest_version_number: row.latest_version_number
    });
    deliverablesByTask.set(row.task_id, deliverables);
  }

  return rows.map((row) => {
    const assignees = assigneesByTask.get(row.id) ?? [];
    return {
      ...row,
      due_date: normalizeDateOnly(row.due_date as string | Date | null),
      assigned_to: assignees[0]?.id ?? row.assigned_to,
      assignees,
      labels: labelsByTask.get(row.id) ?? [],
      deliverables: deliverablesByTask.get(row.id) ?? []
    };
  });
}

async function syncTaskAssignees(client: PoolClient, input: {
  taskId: string;
  assigneeIds: string[];
  assignedBy: string;
}) {
  const assigneeIds = [...new Set(input.assigneeIds)];
  await client.query("DELETE FROM task_assignees WHERE task_id = $1", [input.taskId]);

  for (const userId of assigneeIds) {
    await client.query(
      `INSERT INTO task_assignees (task_id, user_id, assigned_by)
       VALUES ($1, $2, $3)`,
      [input.taskId, userId, input.assignedBy]
    );
  }
}

async function syncTaskLabels(client: PoolClient, input: {
  taskId: string;
  projectId: string;
  labels: TaskLabelInput[];
  createdBy: string;
}) {
  await client.query("DELETE FROM task_label_assignments WHERE task_id = $1", [input.taskId]);
  const labels = [...new Map(input.labels.map((label) => [label.name.trim().toLowerCase(), { ...label, name: label.name.trim() }])).values()];

  for (const label of labels) {
    const existing = await client.query<{ id: string }>(
      `SELECT id
       FROM task_labels
       WHERE project_id = $1 AND lower(name) = lower($2)
       LIMIT 1`,
      [input.projectId, label.name]
    );

    let labelId = existing.rows[0]?.id;
    if (labelId) {
      await client.query("UPDATE task_labels SET color = $1 WHERE id = $2", [label.color, labelId]);
    } else {
      const created = await client.query<{ id: string }>(
        `INSERT INTO task_labels (project_id, name, color, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [input.projectId, label.name, label.color, input.createdBy]
      );
      labelId = created.rows[0].id;
    }

    await client.query(
      `INSERT INTO task_label_assignments (task_id, label_id)
       VALUES ($1, $2)`,
      [input.taskId, labelId]
    );
  }
}

type ListTasksFilter = {
  projectId?: string;
  assignedTo?: string;
  status?: TaskStatus;
  phase?: ProjectPhase;
  overdue?: boolean;
  page?: number;
  pageSize?: number;
  sortBy?: "createdAt" | "updatedAt" | "dueDate" | "priority" | "status" | "title";
  sortOrder?: "asc" | "desc";
};

const TASK_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["in_progress"],
  in_progress: ["completed", "blocked"],
  blocked: ["in_progress"],
  completed: []
};

type TaskTransitionResult =
  | { ok: true; task: TaskRow }
  | { ok: false; reason: "not_found" | "invalid_transition" | "deliverable_required" };

export async function listTasks(filter: ListTasksFilter, userId: string) {
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const sortBy = filter.sortBy ?? "createdAt";
  const sortOrder = filter.sortOrder ?? "desc";
  const orderColumnMap: Record<NonNullable<ListTasksFilter["sortBy"]>, string> = {
    createdAt: "t.created_at",
    updatedAt: "t.updated_at",
    dueDate: "t.due_date",
    priority: "t.priority",
    status: "t.status",
    title: "t.title"
  };
  const orderColumn = orderColumnMap[sortBy];
  const orderDirection = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

  const where: string[] = [
    "t.deleted_at IS NULL",
    `EXISTS (
      SELECT 1
      FROM projects p
      LEFT JOIN project_team pt
        ON pt.project_id = p.id
       AND pt.user_id = $1
      WHERE p.id = t.project_id
        AND p.deleted_at IS NULL
        AND (p.created_by = $1 OR pt.user_id IS NOT NULL)
    )`
  ];
  const values: Array<string> = [userId];

  if (filter.projectId) {
    values.push(filter.projectId);
    where.push(`t.project_id = $${values.length}`);
  }
  if (filter.assignedTo) {
    values.push(filter.assignedTo);
    where.push(`EXISTS (
      SELECT 1 FROM task_assignees ta
      WHERE ta.task_id = t.id AND ta.user_id = $${values.length}
    )`);
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
       project.name AS project_name,
       t.title,
       t.description,
       t.phase,
       t.status,
       t.priority,
       t.deliverable_required,
       t.assigned_to,
       t.due_date,
       t.completed_at,
       t.created_by,
       t.created_at,
       t.updated_at
     FROM tasks t
     JOIN projects project ON project.id = t.project_id
     WHERE ${where.join(" AND ")}
     ORDER BY ${orderColumn} ${orderDirection}
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
    rows: await hydrateTaskRelations(dataResult.rows),
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
       t.deliverable_required,
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

  const rows = await hydrateTaskRelations(result.rows);
  return rows[0] ?? null;
}

export async function createTask(input: {
  projectId: string;
  title: string;
  description?: string | null;
  phase: ProjectPhase;
  status?: TaskStatus;
  priority?: PriorityLevel;
  deliverableRequired?: boolean;
  assignedTo?: string | null;
  assigneeIds?: string[];
  labels?: TaskLabelInput[];
  dueDate?: string | null;
  deliverable?: TaskDeliverableSelection;
  createdBy: string;
}) {
  const client = await pool.connect();
  const assigneeIds = input.assigneeIds ?? (input.assignedTo ? [input.assignedTo] : []);
  const deliverableRequired = input.deliverableRequired ?? Boolean(input.deliverable);
  let assignmentEventKey: string | null = null;

  try {
    await client.query("BEGIN");
    await assertEligibleTaskAssignees(client, { projectId: input.projectId, assigneeIds });
    if (deliverableRequired && input.status === "completed") throw new TaskDeliverableRequiredError();
    const result = await client.query<TaskRow>(
      `INSERT INTO tasks (
         project_id, title, description, phase, status, priority,
         deliverable_required, assigned_to, due_date, completed_at, created_by, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5::task_status, $6,
         $7, $8, $9::date, CASE WHEN $5::task_status = 'completed' THEN NOW() ELSE NULL END, $10, NOW(), NOW()
       )
       RETURNING
         id, project_id, title, description, phase, status, priority,
         deliverable_required, assigned_to, due_date, completed_at, created_by, created_at, updated_at`,
      [
        input.projectId,
        input.title,
        input.description ?? null,
        input.phase,
        input.status ?? "pending",
        input.priority ?? "medium",
        deliverableRequired,
        assigneeIds[0] ?? null,
        input.dueDate ?? null,
        input.createdBy
      ]
    );

    const task = result.rows[0];
    await syncTaskAssignees(client, { taskId: task.id, assigneeIds, assignedBy: input.createdBy });
    await syncTaskLabels(client, {
      taskId: task.id,
      projectId: task.project_id,
      labels: input.labels ?? [],
      createdBy: input.createdBy
    });

    if (input.deliverable) {
      let deliverableId: string;
      if (input.deliverable.mode === "existing") {
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM deliverables
           WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
          [input.deliverable.deliverableId, input.projectId]
        );
        if (!existing.rows[0]) throw new InvalidTaskDeliverableError();
        deliverableId = existing.rows[0].id;
      } else {
        const created = await client.query<{ id: string }>(
          `INSERT INTO deliverables (project_id, title, description, status, created_by)
           VALUES ($1, $2, $3, 'draft', $4)
           RETURNING id`,
          [input.projectId, input.deliverable.title, input.deliverable.description ?? null, input.createdBy]
        );
        deliverableId = created.rows[0].id;
      }

      await client.query(
        `INSERT INTO deliverable_tasks (deliverable_id, task_id)
         VALUES ($1, $2)`,
        [deliverableId, task.id]
      );
    }
    if (assigneeIds.length > 0) {
      assignmentEventKey = `task:${task.id}:assignment-created`;
      await enqueueNotificationEvent(
        client,
        assignmentEventKey,
        assigneeIds,
        {
          projectId: task.project_id,
          taskId: task.id,
          type: "task_assigned",
          title: "Task assigned",
          message: `You were assigned to task "${task.title}".`,
          metadata: {
            taskId: task.id,
            projectId: task.project_id,
            assignedByUserId: input.createdBy,
            href: `/projects/${task.project_id}?tab=tasks&task=${task.id}`
          },
          actionRequired: true
        },
        { excludeUserIds: [input.createdBy] }
      );
    }
    await client.query("COMMIT");

    if (assignmentEventKey) await deliverQueuedNotificationEvent(assignmentEventKey);

    return (await getTaskById(task.id))!;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function attachDeliverableToTask(input: {
  taskId: string;
  projectId: string;
  selection: TaskDeliverableSelection;
  userId: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let deliverable: Pick<TaskDeliverable, "id" | "title" | "status">;

    if (input.selection.mode === "existing") {
      const result = await client.query<Pick<TaskDeliverable, "id" | "title" | "status">>(
        `SELECT id, title, status FROM deliverables
         WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
        [input.selection.deliverableId, input.projectId]
      );
      if (!result.rows[0]) {
        await client.query("ROLLBACK");
        return { ok: false as const, reason: "invalid_deliverable" as const };
      }
      deliverable = result.rows[0];
    } else {
      const result = await client.query<Pick<TaskDeliverable, "id" | "title" | "status">>(
        `INSERT INTO deliverables (project_id, title, description, status, created_by)
         VALUES ($1, $2, $3, 'draft', $4)
         RETURNING id, title, status`,
        [input.projectId, input.selection.title, input.selection.description ?? null, input.userId]
      );
      deliverable = result.rows[0];
    }

    await client.query(
      `INSERT INTO deliverable_tasks (deliverable_id, task_id)
       VALUES ($1, $2)
       ON CONFLICT (deliverable_id, task_id) DO NOTHING`,
      [deliverable.id, input.taskId]
    );
    await client.query(
      `UPDATE tasks SET deliverable_required = TRUE, updated_at = NOW() WHERE id = $1`,
      [input.taskId]
    );
    await client.query("COMMIT");
    return { ok: true as const, deliverable };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateTask(
  taskId: string,
  input: {
    projectId?: string;
    title?: string;
    description?: string | null;
    phase?: ProjectPhase;
    priority?: PriorityLevel;
    deliverableRequired?: boolean;
    assignedTo?: string | null;
    assigneeIds?: string[];
    labels?: TaskLabelInput[];
    dueDate?: string | null;
  },
  updatedBy?: string
) {
  const client = await pool.connect();
  const requestedAssigneeIds = input.assigneeIds
    ?? (typeof input.assignedTo !== "undefined" ? (input.assignedTo ? [input.assignedTo] : []) : undefined);
  let assignmentEventKey: string | null = null;

  try {
    await client.query("BEGIN");
    const currentResult = await client.query<TaskRow>(
      `SELECT id, project_id, title, description, phase, status, priority,
         deliverable_required, assigned_to, due_date, completed_at, created_by, created_at, updated_at
       FROM tasks
       WHERE id = $1 AND deleted_at IS NULL
       FOR UPDATE`,
      [taskId]
    );
    const currentTask = currentResult.rows[0];
    if (!currentTask) {
      await client.query("ROLLBACK");
      return null;
    }

    const targetProjectId = input.projectId ?? currentTask.project_id;
    const projectChanged = targetProjectId !== currentTask.project_id;
    if (projectChanged) {
      const linked = await client.query<{ linked: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM deliverable_tasks WHERE task_id = $1) AS linked`,
        [taskId]
      );
      if (linked.rows[0]?.linked) throw new TaskProjectMoveConflictError();
    }

    let effectiveAssigneeIds = requestedAssigneeIds;
    const previousAssigneeIds = typeof effectiveAssigneeIds !== "undefined" || projectChanged
      ? (await client.query<{ user_id: string }>(
          "SELECT user_id FROM task_assignees WHERE task_id = $1 ORDER BY assigned_at ASC",
          [taskId]
        )).rows.map((row) => row.user_id)
      : [];
    if (projectChanged && typeof effectiveAssigneeIds === "undefined") {
      effectiveAssigneeIds = previousAssigneeIds;
    }
    if (typeof effectiveAssigneeIds !== "undefined") {
      await assertEligibleTaskAssignees(client, {
        projectId: targetProjectId,
        assigneeIds: effectiveAssigneeIds
      });
    }

    const fields: string[] = [];
    const values: Array<string | boolean | null> = [];
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
    if (typeof input.deliverableRequired !== "undefined") {
      fields.push(`deliverable_required = $${fields.length + 1}`);
      values.push(input.deliverableRequired);
    }
    if (typeof effectiveAssigneeIds !== "undefined") {
      fields.push(`assigned_to = $${fields.length + 1}`);
      values.push(effectiveAssigneeIds[0] ?? null);
    }
    if (typeof input.dueDate !== "undefined") {
      fields.push(`due_date = $${fields.length + 1}::date`);
      values.push(input.dueDate);
    }

    if (fields.length === 0 && typeof input.labels === "undefined") {
      await client.query("ROLLBACK");
      return getTaskById(taskId);
    }

    const result = fields.length > 0
      ? await client.query<TaskRow>(
        `UPDATE tasks
         SET ${fields.join(", ")}, updated_at = NOW()
         WHERE id = $${fields.length + 1} AND deleted_at IS NULL
         RETURNING
           id, project_id, title, description, phase, status, priority,
           deliverable_required, assigned_to, due_date, completed_at, created_by, created_at, updated_at`,
        [...values, taskId]
      )
      : await client.query<TaskRow>(
        `UPDATE tasks
         SET updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING
           id, project_id, title, description, phase, status, priority,
           deliverable_required, assigned_to, due_date, completed_at, created_by, created_at, updated_at`,
        [taskId]
      );

    const task = result.rows[0];
    if (!task) {
      await client.query("ROLLBACK");
      return null;
    }

    if (typeof effectiveAssigneeIds !== "undefined") {
      await syncTaskAssignees(client, {
        taskId,
        assigneeIds: effectiveAssigneeIds,
        assignedBy: updatedBy ?? task.created_by
      });
      const previousAssigneeSet = new Set(previousAssigneeIds);
      const effectiveAssigneeSet = new Set(effectiveAssigneeIds);
      const removedAssigneeIds = previousAssigneeIds.filter((userId) => !effectiveAssigneeSet.has(userId));
      const addedAssigneeIds = effectiveAssigneeIds.filter((userId) => !previousAssigneeSet.has(userId));
      if (removedAssigneeIds.length > 0) {
        await resolveTaskActionNotifications(
          task.id,
          "task_unassigned",
          removedAssigneeIds,
          client
        );
      }
      if (addedAssigneeIds.length > 0) {
        assignmentEventKey = `task:${task.id}:assignment-updated:${randomUUID()}`;
        await enqueueNotificationEvent(
          client,
          assignmentEventKey,
          addedAssigneeIds,
          {
            projectId: task.project_id,
            taskId: task.id,
            type: "task_assigned",
            title: "Task assigned",
            message: `You were assigned to task "${task.title}".`,
            metadata: {
              taskId: task.id,
              projectId: task.project_id,
              assignedByUserId: updatedBy ?? task.created_by,
              reassigned: true,
              href: `/projects/${task.project_id}?tab=tasks&task=${task.id}`
            },
            actionRequired: true
          },
          { excludeUserIds: [updatedBy ?? task.created_by] }
        );
      }
    }
    if (projectChanged) {
      await client.query("DELETE FROM task_label_assignments WHERE task_id = $1", [taskId]);
    }
    if (input.labels) {
      await syncTaskLabels(client, {
        taskId,
        projectId: task.project_id,
        labels: input.labels,
        createdBy: updatedBy ?? task.created_by
      });
    }

    await client.query("COMMIT");
    if (assignmentEventKey) await deliverQueuedNotificationEvent(assignmentEventKey);
    return getTaskById(taskId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
         deliverable_required, assigned_to, due_date, completed_at, created_by, created_at, updated_at
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

    if (input.nextStatus === "completed" && existingTask.deliverable_required) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "deliverable_required" };
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
         deliverable_required, assigned_to, due_date, completed_at, created_by, created_at, updated_at`,
      [input.nextStatus, input.taskId]
    );

    await client.query("COMMIT");
    const hydratedTask = await getTaskById(updatedTaskQuery.rows[0].id);

    return { ok: true, task: hydratedTask! };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function bulkTransitionTaskStatus(input: {
  taskIds: string[];
  nextStatus: TaskStatus;
}) {
  const results: Array<{
    taskId: string;
    ok: boolean;
    reason?: "not_found" | "invalid_transition" | "deliverable_required";
    task?: TaskRow;
  }> = [];

  for (const taskId of input.taskIds) {
    const result = await transitionTaskStatus({
      taskId,
      nextStatus: input.nextStatus
    });

    if (!result.ok) {
      results.push({
        taskId,
        ok: false,
        reason: result.reason
      });
      continue;
    }

    results.push({
      taskId,
      ok: true,
      task: result.task
    });
  }

  return results;
}

export async function bulkDeleteTasks(taskIds: string[]) {
  if (taskIds.length === 0) {
    return { deletedCount: 0, deletedIds: [] as string[] };
  }

  const result = await pool.query<{ id: string }>(
    `UPDATE tasks
     SET deleted_at = NOW(), updated_at = NOW()
     WHERE id = ANY($1::uuid[])
       AND deleted_at IS NULL
     RETURNING id`,
    [taskIds]
  );

  return {
    deletedCount: result.rowCount,
    deletedIds: result.rows.map((row) => row.id)
  };
}
