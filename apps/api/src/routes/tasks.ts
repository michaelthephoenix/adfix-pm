import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { insertActivityLog } from "../services/activity-log.service.js";
import {
  createTask,
  deleteTask,
  getTaskById,
  listTasks,
  transitionTaskStatus,
  updateTask
} from "../services/tasks.service.js";

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
  overdue: z.coerce.boolean().optional()
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

const idParamsSchema = z.object({
  id: z.string().uuid()
});

tasksRouter.use(requireAuth);

tasksRouter.get("/", async (req, res) => {
  const parsed = listTasksQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid tasks query" });
  }

  const tasks = await listTasks(parsed.data);
  return res.status(200).json({ data: tasks });
});

tasksRouter.get("/:id", async (req, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({ error: "Invalid task id" });
  }

  const task = await getTaskById(parsedParams.data.id);
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }

  return res.status(200).json({ data: task });
});

tasksRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const parsed = taskCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid task payload" });
  }

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
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
    return res.status(400).json({ error: "Invalid task id" });
  }

  const parsed = taskUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid task payload" });
  }

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
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
    return res.status(400).json({ error: "Invalid task id" });
  }

  const parsed = taskStatusPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid status payload" });
  }

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const existingTask = await getTaskById(parsedParams.data.id);
  if (!existingTask) {
    return res.status(404).json({ error: "Task not found" });
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
    return res.status(400).json({ error: "Invalid task id" });
  }

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const existingTask = await getTaskById(parsedParams.data.id);
  if (!existingTask) {
    return res.status(404).json({ error: "Task not found" });
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

