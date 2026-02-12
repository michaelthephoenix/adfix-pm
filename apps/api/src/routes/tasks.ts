import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { insertActivityLog } from "../services/activity-log.service.js";
import {
  bulkDeleteTasks,
  bulkTransitionTaskStatus,
  createTask,
  deleteTask,
  getTaskById,
  listTasks,
  transitionTaskStatus,
  updateTask
} from "../services/tasks.service.js";
import { getProjectById } from "../services/projects.service.js";
import { hasProjectPermission } from "../services/rbac.service.js";
import { sendValidationError } from "../utils/validation.js";

export const tasksRouter = Router();

const projectPhaseEnum = z.enum([
  "client_acquisition",
  "strategy_planning",
  "production",
  "post_production",
  "delivery"
]);

const taskStatusEnum = z.enum(["pending", "in_progress", "completed", "blocked"]);
const priorityEnum = z.enum(["low", "medium", "high", "urgent"]);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD");

const listTasksQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  status: taskStatusEnum.optional(),
  phase: projectPhaseEnum.optional(),
  overdue: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20)
});

const taskCreateSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(10000).optional().nullable(),
  phase: projectPhaseEnum,
  status: taskStatusEnum.optional(),
  priority: priorityEnum.optional(),
  assignedTo: z.string().uuid().optional().nullable(),
  dueDate: isoDateSchema.optional().nullable()
});

const taskUpdateSchema = taskCreateSchema
  .omit({ status: true })
  .partial();

const taskStatusPatchSchema = z.object({
  status: taskStatusEnum,
  reason: z.string().trim().max(1000).optional().nullable()
});

const bulkTaskIdsSchema = z.array(z.string().uuid()).min(1).max(200);

const bulkStatusPatchSchema = z.object({
  taskIds: bulkTaskIdsSchema,
  status: taskStatusEnum,
  reason: z.string().trim().max(1000).optional().nullable()
});

const bulkDeleteSchema = z.object({
  taskIds: bulkTaskIdsSchema
});

const idParamsSchema = z.object({
  id: z.string().uuid()
});

tasksRouter.use(requireAuth);

tasksRouter.get("/", async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const parsed = listTasksQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid tasks query", parsed.error);
  }

  if (parsed.data.projectId) {
    const project = await getProjectById(parsed.data.projectId);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const canViewProject = await hasProjectPermission({
      projectId: parsed.data.projectId,
      userId: req.user.id,
      permission: "project:view"
    });
    if (!canViewProject) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const result = await listTasks(parsed.data, req.user.id);
  return res.status(200).json({
    data: result.rows,
    meta: {
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      total: result.total
    }
  });
});

tasksRouter.post("/bulk/status", async (req: AuthenticatedRequest, res) => {
  const parsed = bulkStatusPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid bulk status payload", parsed.error);
  }

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const loadedTasks = await Promise.all(parsed.data.taskIds.map((taskId) => getTaskById(taskId)));
  for (const task of loadedTasks) {
    if (!task) {
      return res.status(404).json({ error: "Task not found in bulk request" });
    }

    const canWriteTask = await hasProjectPermission({
      projectId: task.project_id,
      userId: req.user.id,
      permission: "task:write"
    });
    if (!canWriteTask) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const originalTasks = await Promise.all(parsed.data.taskIds.map((taskId) => getTaskById(taskId)));
  const originalById = new Map(
    originalTasks.filter((t): t is NonNullable<typeof t> => Boolean(t)).map((task) => [task.id, task])
  );

  const results = await bulkTransitionTaskStatus({
    taskIds: parsed.data.taskIds,
    nextStatus: parsed.data.status
  });

  for (const result of results) {
    if (!result.ok || !result.task) continue;

    const original = originalById.get(result.task.id);
    await insertActivityLog({
      userId: req.user.id,
      action: "task_status_changed",
      projectId: result.task.project_id,
      details: {
        taskId: result.task.id,
        from: original?.status ?? null,
        to: result.task.status,
        reason: parsed.data.reason ?? null,
        bulk: true
      }
    });
  }

  return res.status(200).json({
    data: {
      updatedCount: results.filter((r) => r.ok).length,
      failedCount: results.filter((r) => !r.ok).length,
      results: results.map((result) => ({
        taskId: result.taskId,
        ok: result.ok,
        reason: result.reason ?? null
      }))
    }
  });
});

tasksRouter.post("/bulk/delete", async (req: AuthenticatedRequest, res) => {
  const parsed = bulkDeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid bulk delete payload", parsed.error);
  }

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const existingTasks = await Promise.all(parsed.data.taskIds.map((taskId) => getTaskById(taskId)));
  for (const task of existingTasks) {
    if (!task) {
      return res.status(404).json({ error: "Task not found in bulk request" });
    }

    const canWriteTask = await hasProjectPermission({
      projectId: task.project_id,
      userId: req.user.id,
      permission: "task:write"
    });
    if (!canWriteTask) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const existingById = new Map(
    existingTasks.filter((t): t is NonNullable<typeof t> => Boolean(t)).map((task) => [task.id, task])
  );

  const result = await bulkDeleteTasks(parsed.data.taskIds);

  for (const taskId of result.deletedIds) {
    const existingTask = existingById.get(taskId);
    if (!existingTask) continue;

    await insertActivityLog({
      userId: req.user.id,
      action: "task_deleted",
      projectId: existingTask.project_id,
      details: { taskId: existingTask.id, bulk: true }
    });
  }

  return res.status(200).json({
    data: {
      deletedCount: result.deletedCount,
      deletedIds: result.deletedIds
    }
  });
});

tasksRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid task id", parsedParams.error);
  }

  const task = await getTaskById(parsedParams.data.id);
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const canViewTask = await hasProjectPermission({
    projectId: task.project_id,
    userId: req.user.id,
    permission: "project:view"
  });
  if (!canViewTask) {
    return res.status(403).json({ error: "Forbidden" });
  }

  return res.status(200).json({ data: task });
});

tasksRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const parsed = taskCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid task payload", parsed.error);
  }

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const project = await getProjectById(parsed.data.projectId);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  const canWriteTask = await hasProjectPermission({
    projectId: parsed.data.projectId,
    userId: req.user.id,
    permission: "task:write"
  });
  if (!canWriteTask) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const task = await createTask({
    ...parsed.data,
    createdBy: req.user.id
  });

  await insertActivityLog({
    userId: req.user.id,
    action: "task_created",
    projectId: task.project_id,
    details: { taskId: task.id, status: task.status }
  });

  return res.status(201).json({ data: task });
});

tasksRouter.put("/:id", async (req: AuthenticatedRequest, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid task id", parsedParams.error);
  }

  const parsed = taskUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid task payload", parsed.error);
  }

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const existingTask = await getTaskById(parsedParams.data.id);
  if (!existingTask) {
    return res.status(404).json({ error: "Task not found" });
  }

  const canWriteTask = await hasProjectPermission({
    projectId: existingTask.project_id,
    userId: req.user.id,
    permission: "task:write"
  });
  if (!canWriteTask) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const task = await updateTask(parsedParams.data.id, parsed.data);
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }

  await insertActivityLog({
    userId: req.user.id,
    action: "task_updated",
    projectId: task.project_id,
    details: { taskId: task.id, updatedFields: Object.keys(parsed.data) }
  });

  return res.status(200).json({ data: task });
});

tasksRouter.patch("/:id/status", async (req: AuthenticatedRequest, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid task id", parsedParams.error);
  }

  const parsed = taskStatusPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid status payload", parsed.error);
  }

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const existingTask = await getTaskById(parsedParams.data.id);
  if (!existingTask) {
    return res.status(404).json({ error: "Task not found" });
  }

  const canWriteTask = await hasProjectPermission({
    projectId: existingTask.project_id,
    userId: req.user.id,
    permission: "task:write"
  });
  if (!canWriteTask) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const result = await transitionTaskStatus({
    taskId: parsedParams.data.id,
    nextStatus: parsed.data.status
  });

  if (!result.ok) {
    if (result.reason === "not_found") {
      return res.status(404).json({ error: "Task not found" });
    }

    return res.status(409).json({ error: "Invalid status transition" });
  }

  await insertActivityLog({
    userId: req.user.id,
    action: "task_status_changed",
    projectId: result.task.project_id,
    details: {
      taskId: result.task.id,
      from: existingTask.status,
      to: result.task.status,
      reason: parsed.data.reason ?? null
    }
  });

  return res.status(200).json({ data: result.task });
});

tasksRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid task id", parsedParams.error);
  }

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const existingTask = await getTaskById(parsedParams.data.id);
  if (!existingTask) {
    return res.status(404).json({ error: "Task not found" });
  }

  const canWriteTask = await hasProjectPermission({
    projectId: existingTask.project_id,
    userId: req.user.id,
    permission: "task:write"
  });
  if (!canWriteTask) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const deleted = await deleteTask(parsedParams.data.id);
  if (!deleted) {
    return res.status(404).json({ error: "Task not found" });
  }

  await insertActivityLog({
    userId: req.user.id,
    action: "task_deleted",
    projectId: existingTask.project_id,
    details: { taskId: existingTask.id }
  });

  return res.status(204).send();
});
