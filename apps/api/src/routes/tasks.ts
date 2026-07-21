import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { insertActivityLog } from "../services/activity-log.service.js";
import {
  bulkDeleteTasks,
  bulkTransitionTaskStatus,
  attachDeliverableToTask,
  createTask,
  deleteTask,
  getTaskById,
  listTasks,
  transitionTaskStatus,
  updateTask,
  validateTaskAssigneesForProject,
  InvalidTaskDeliverableError,
  InvalidTaskAssigneesError,
  TaskDeliverableRequiredError,
  TaskProjectMoveConflictError
} from "../services/tasks.service.js";
import { getProjectById } from "../services/projects.service.js";
import {
  createTaskComment,
  deleteTaskComment,
  listTaskComments
} from "../services/task-comments.service.js";
import { hasProjectPermission } from "../services/rbac.service.js";
import { resolveTaskActionNotifications } from "../services/notifications.service.js";
import { logAndSendForbidden } from "../utils/authz.js";
import { sendConflict, sendNotFound, sendUnauthorized } from "../utils/http-error.js";
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
const taskLabelColorEnum = z.enum(["violet", "blue", "green", "amber", "rose", "slate"]);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD");
const taskLabelSchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: taskLabelColorEnum
});
const taskDeliverableSelectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("existing"), deliverableId: z.string().uuid() }),
  z.object({
    mode: z.literal("new"),
    title: z.string().trim().min(1).max(255),
    description: z.string().trim().max(4000).optional().nullable()
  })
]);

const listTasksQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  status: taskStatusEnum.optional(),
  phase: projectPhaseEnum.optional(),
  overdue: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  sortBy: z.enum(["createdAt", "updatedAt", "dueDate", "priority", "status", "title"]).optional().default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc")
});

const taskCreateSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().max(10000).optional().nullable(),
  phase: projectPhaseEnum.optional(),
  status: taskStatusEnum.optional(),
  priority: priorityEnum.optional(),
  deliverableRequired: z.boolean().optional(),
  assignedTo: z.string().uuid().optional().nullable(),
  assigneeIds: z.array(z.string().uuid()).max(20).optional(),
  labels: z.array(taskLabelSchema).max(12).optional(),
  dueDate: isoDateSchema.optional().nullable(),
  deliverable: taskDeliverableSelectionSchema.optional()
});

const taskUpdateSchema = taskCreateSchema
  .omit({ status: true, deliverable: true })
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

const bulkUpdateSchema = z.object({
  taskIds: bulkTaskIdsSchema,
  assigneeIds: z.array(z.string().uuid()).max(20).optional(),
  phase: projectPhaseEnum.optional(),
  priority: priorityEnum.optional(),
  addLabels: z.array(taskLabelSchema).max(12).optional()
}).superRefine((value, context) => {
  if (
    typeof value.assigneeIds === "undefined"
    && typeof value.phase === "undefined"
    && typeof value.priority === "undefined"
    && typeof value.addLabels === "undefined"
  ) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Choose at least one bulk update" });
  }
});

const idParamsSchema = z.object({
  id: z.string().uuid()
});

const taskCommentParamsSchema = z.object({
  id: z.string().uuid(),
  commentId: z.string().uuid()
});

const listTaskCommentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc")
});

const createTaskCommentSchema = z.object({
  body: z.string().trim().min(1).max(5000)
});

tasksRouter.use(requireAuth);

tasksRouter.get("/", async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const parsed = listTasksQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid tasks query", parsed.error);
  }

  if (parsed.data.projectId) {
    const project = await getProjectById(parsed.data.projectId);
    if (!project) {
      return sendNotFound(res, "Project not found");
    }

    const canViewProject = await hasProjectPermission({
      projectId: parsed.data.projectId,
      userId: req.user.id,
      permission: "project:view"
    });
    if (!canViewProject) {
      return logAndSendForbidden({
        req,
        res,
        permission: "project:view",
        projectId: parsed.data.projectId
      });
    }
  }

  const result = await listTasks(parsed.data, req.user.id);
  return res.status(200).json({
    data: result.rows,
    meta: {
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      sortBy: parsed.data.sortBy,
      sortOrder: parsed.data.sortOrder,
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
    return sendUnauthorized(res, "Unauthorized");
  }

  const loadedTasks = await Promise.all(parsed.data.taskIds.map((taskId) => getTaskById(taskId)));
  for (const task of loadedTasks) {
    if (!task) {
      return sendNotFound(res, "Task not found in bulk request");
    }

    const canWriteTask = await hasProjectPermission({
      projectId: task.project_id,
      userId: req.user.id,
      permission: "task:write"
    });
    if (!canWriteTask) {
      return logAndSendForbidden({
        req,
        res,
        permission: "task:write",
        projectId: task.project_id
      });
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
    if (result.task.status === "completed") {
      await resolveTaskActionNotifications(result.task.id);
    }
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

tasksRouter.post("/bulk/update", async (req: AuthenticatedRequest, res) => {
  const parsed = bulkUpdateSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, "Invalid bulk task update", parsed.error);
  if (!req.user) return sendUnauthorized(res, "Unauthorized");

  const tasks = await Promise.all(parsed.data.taskIds.map((taskId) => getTaskById(taskId)));
  if (tasks.some((task) => !task)) return sendNotFound(res, "Task not found in bulk request");
  const loadedTasks = tasks.filter((task): task is NonNullable<typeof task> => Boolean(task));
  const projectIds = [...new Set(loadedTasks.map((task) => task.project_id))];
  if (projectIds.length !== 1) {
    return sendConflict(res, "Bulk assignment and classification actions must target one project at a time");
  }
  const projectId = projectIds[0];
  const canWriteTask = await hasProjectPermission({
    projectId,
    userId: req.user.id,
    permission: "task:write"
  });
  if (!canWriteTask) {
    return logAndSendForbidden({ req, res, permission: "task:write", projectId });
  }

  try {
    if (parsed.data.assigneeIds) {
      await validateTaskAssigneesForProject({ projectId, assigneeIds: parsed.data.assigneeIds });
    }
    if (parsed.data.addLabels) {
      const labelsToAdd = parsed.data.addLabels;
      const exceedsLimit = loadedTasks.some((task) => {
        const names = new Set(task.labels.map((label) => label.name.trim().toLowerCase()));
        for (const label of labelsToAdd) names.add(label.name.trim().toLowerCase());
        return names.size > 12;
      });
      if (exceedsLimit) return sendConflict(res, "One or more tasks would exceed the 12-label limit");
    }

    const updatedTasks = [];
    for (const task of loadedTasks) {
      const labels = parsed.data.addLabels
        ? [...new Map(
            [...task.labels, ...parsed.data.addLabels]
              .map((label) => [label.name.trim().toLowerCase(), { name: label.name, color: label.color }])
          ).values()]
        : undefined;
      const updated = await updateTask(task.id, {
        assigneeIds: parsed.data.assigneeIds,
        phase: parsed.data.phase,
        priority: parsed.data.priority,
        labels
      }, req.user.id);
      if (updated) updatedTasks.push(updated);
    }

    await Promise.all(updatedTasks.map((task) => insertActivityLog({
      userId: req.user!.id,
      action: "task_updated",
      projectId: task.project_id,
      details: {
        taskId: task.id,
        bulk: true,
        updatedFields: [
          ...(typeof parsed.data.assigneeIds !== "undefined" ? ["assigneeIds"] : []),
          ...(parsed.data.phase ? ["phase"] : []),
          ...(parsed.data.priority ? ["priority"] : []),
          ...(parsed.data.addLabels ? ["labels"] : [])
        ]
      }
    })));
    return res.status(200).json({ data: { updatedCount: updatedTasks.length, tasks: updatedTasks } });
  } catch (error) {
    if (error instanceof InvalidTaskAssigneesError) return sendConflict(res, error.message);
    throw error;
  }
});

tasksRouter.post("/bulk/delete", async (req: AuthenticatedRequest, res) => {
  const parsed = bulkDeleteSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid bulk delete payload", parsed.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const existingTasks = await Promise.all(parsed.data.taskIds.map((taskId) => getTaskById(taskId)));
  for (const task of existingTasks) {
    if (!task) {
      return sendNotFound(res, "Task not found in bulk request");
    }

    const canWriteTask = await hasProjectPermission({
      projectId: task.project_id,
      userId: req.user.id,
      permission: "task:write"
    });
    if (!canWriteTask) {
      return logAndSendForbidden({
        req,
        res,
        permission: "task:write",
        projectId: task.project_id
      });
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
    await resolveTaskActionNotifications(existingTask.id, "task_deleted");
  }

  return res.status(200).json({
    data: {
      deletedCount: result.deletedCount,
      deletedIds: result.deletedIds
    }
  });
});

tasksRouter.get("/:id/comments", async (req: AuthenticatedRequest, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid task id", parsedParams.error);
  }

  const parsedQuery = listTaskCommentsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return sendValidationError(res, "Invalid task comments query", parsedQuery.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const task = await getTaskById(parsedParams.data.id);
  if (!task) {
    return sendNotFound(res, "Task not found");
  }

  const canViewTask = await hasProjectPermission({
    projectId: task.project_id,
    userId: req.user.id,
    permission: "project:view"
  });
  if (!canViewTask) {
    return logAndSendForbidden({
      req,
      res,
      permission: "project:view",
      projectId: task.project_id
    });
  }

  const result = await listTaskComments({
    taskId: task.id,
    page: parsedQuery.data.page,
    pageSize: parsedQuery.data.pageSize,
    sortOrder: parsedQuery.data.sortOrder
  });

  return res.status(200).json({
    data: result.rows,
    meta: {
      page: parsedQuery.data.page,
      pageSize: parsedQuery.data.pageSize,
      sortOrder: parsedQuery.data.sortOrder,
      total: result.total
    }
  });
});

tasksRouter.post("/:id/comments", async (req: AuthenticatedRequest, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid task id", parsedParams.error);
  }

  const parsedBody = createTaskCommentSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return sendValidationError(res, "Invalid task comment payload", parsedBody.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const task = await getTaskById(parsedParams.data.id);
  if (!task) {
    return sendNotFound(res, "Task not found");
  }

  const canWriteTask = await hasProjectPermission({
    projectId: task.project_id,
    userId: req.user.id,
    permission: "task:write"
  });
  if (!canWriteTask) {
    return logAndSendForbidden({
      req,
      res,
      permission: "task:write",
      projectId: task.project_id
    });
  }

  const comment = await createTaskComment({
    taskId: task.id,
    userId: req.user.id,
    body: parsedBody.data.body
  });

  await insertActivityLog({
    userId: req.user.id,
    action: "task_comment_created",
    projectId: task.project_id,
    details: {
      taskId: task.id,
      commentId: comment.id
    }
  });

  return res.status(201).json({ data: comment });
});

tasksRouter.delete("/:id/comments/:commentId", async (req: AuthenticatedRequest, res) => {
  const parsedParams = taskCommentParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid task comment id", parsedParams.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const task = await getTaskById(parsedParams.data.id);
  if (!task) {
    return sendNotFound(res, "Task not found");
  }

  const canWriteTask = await hasProjectPermission({
    projectId: task.project_id,
    userId: req.user.id,
    permission: "task:write"
  });
  if (!canWriteTask) {
    return logAndSendForbidden({
      req,
      res,
      permission: "task:write",
      projectId: task.project_id
    });
  }

  const canSupervise = await hasProjectPermission({
    projectId: task.project_id,
    userId: req.user.id,
    permission: "deliverable:supervise"
  });
  const deleted = await deleteTaskComment({
    taskId: task.id,
    commentId: parsedParams.data.commentId,
    deletedBy: req.user.id,
    canSupervise
  });
  if (!deleted.ok) {
    if (deleted.reason === "forbidden") {
      return logAndSendForbidden({
        req,
        res,
        permission: "task_comment:delete",
        projectId: task.project_id
      });
    }
    return sendNotFound(res, "Task comment not found");
  }

  await insertActivityLog({
    userId: req.user.id,
    action: "task_comment_deleted",
    projectId: task.project_id,
    details: {
      taskId: task.id,
      commentId: parsedParams.data.commentId
    }
  });

  return res.status(204).send();
});

tasksRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid task id", parsedParams.error);
  }

  const task = await getTaskById(parsedParams.data.id);
  if (!task) {
    return sendNotFound(res, "Task not found");
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const canViewTask = await hasProjectPermission({
    projectId: task.project_id,
    userId: req.user.id,
    permission: "project:view"
  });
  if (!canViewTask) {
    return logAndSendForbidden({
      req,
      res,
      permission: "project:view",
      projectId: task.project_id
    });
  }

  return res.status(200).json({ data: task });
});

tasksRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const parsed = taskCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid task payload", parsed.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const project = await getProjectById(parsed.data.projectId);
  if (!project) {
    return sendNotFound(res, "Project not found");
  }

  const canWriteTask = await hasProjectPermission({
    projectId: parsed.data.projectId,
    userId: req.user.id,
    permission: "task:write"
  });
  if (!canWriteTask) {
    return logAndSendForbidden({
      req,
      res,
      permission: "task:write",
      projectId: parsed.data.projectId
    });
  }

  let task;
  try {
    task = await createTask({
      ...parsed.data,
      phase: parsed.data.phase ?? project.current_phase,
      createdBy: req.user.id
    });
  } catch (error) {
    if (error instanceof InvalidTaskDeliverableError) {
      return sendConflict(res, error.message);
    }
    if (error instanceof InvalidTaskAssigneesError || error instanceof TaskDeliverableRequiredError) {
      return sendConflict(res, error.message);
    }
    throw error;
  }

  await insertActivityLog({
    userId: req.user.id,
    action: "task_created",
    projectId: task.project_id,
    details: { taskId: task.id, status: task.status }
  });

  return res.status(201).json({ data: task });
});

tasksRouter.post("/:id/deliverables", async (req: AuthenticatedRequest, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) return sendValidationError(res, "Invalid task id", parsedParams.error);
  const parsedBody = taskDeliverableSelectionSchema.safeParse(req.body);
  if (!parsedBody.success) return sendValidationError(res, "Invalid deliverable selection", parsedBody.error);
  if (!req.user) return sendUnauthorized(res, "Unauthorized");

  const task = await getTaskById(parsedParams.data.id);
  if (!task) return sendNotFound(res, "Task not found");
  const allowed = await hasProjectPermission({
    projectId: task.project_id,
    userId: req.user.id,
    permission: "task:write"
  });
  if (!allowed) {
    return logAndSendForbidden({ req, res, permission: "task:write", projectId: task.project_id });
  }

  const result = await attachDeliverableToTask({
    taskId: task.id,
    projectId: task.project_id,
    selection: parsedBody.data,
    userId: req.user.id
  });
  if (!result.ok) return sendConflict(res, "The selected deliverable does not belong to this project");

  await insertActivityLog({
    userId: req.user.id,
    action: "task_deliverable_linked",
    projectId: task.project_id,
    details: { taskId: task.id, deliverableId: result.deliverable.id, mode: parsedBody.data.mode }
  });
  return res.status(201).json({ data: result.deliverable });
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
    return sendUnauthorized(res, "Unauthorized");
  }

  const existingTask = await getTaskById(parsedParams.data.id);
  if (!existingTask) {
    return sendNotFound(res, "Task not found");
  }

  const canWriteTask = await hasProjectPermission({
    projectId: existingTask.project_id,
    userId: req.user.id,
    permission: "task:write"
  });
  if (!canWriteTask) {
    return logAndSendForbidden({
      req,
      res,
      permission: "task:write",
      projectId: existingTask.project_id
    });
  }

  if (parsed.data.projectId && parsed.data.projectId !== existingTask.project_id) {
    const targetProject = await getProjectById(parsed.data.projectId);
    if (!targetProject) return sendNotFound(res, "Target project not found");
    const canWriteTarget = await hasProjectPermission({
      projectId: parsed.data.projectId,
      userId: req.user.id,
      permission: "task:write"
    });
    if (!canWriteTarget) {
      return logAndSendForbidden({
        req,
        res,
        permission: "task:write",
        projectId: parsed.data.projectId
      });
    }
  }

  let task;
  try {
    task = await updateTask(parsedParams.data.id, parsed.data, req.user.id);
  } catch (error) {
    if (
      error instanceof InvalidTaskAssigneesError
      || error instanceof TaskProjectMoveConflictError
      || error instanceof TaskDeliverableRequiredError
    ) {
      return sendConflict(res, error.message);
    }
    throw error;
  }
  if (!task) {
    return sendNotFound(res, "Task not found");
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
    return sendUnauthorized(res, "Unauthorized");
  }

  const existingTask = await getTaskById(parsedParams.data.id);
  if (!existingTask) {
    return sendNotFound(res, "Task not found");
  }

  const canWriteTask = await hasProjectPermission({
    projectId: existingTask.project_id,
    userId: req.user.id,
    permission: "task:write"
  });
  if (!canWriteTask) {
    return logAndSendForbidden({
      req,
      res,
      permission: "task:write",
      projectId: existingTask.project_id
    });
  }

  const result = await transitionTaskStatus({
    taskId: parsedParams.data.id,
    nextStatus: parsed.data.status
  });

  if (!result.ok) {
    if (result.reason === "not_found") {
      return sendNotFound(res, "Task not found");
    }

    if (result.reason === "deliverable_required") {
      return sendConflict(res, "Submit the linked deliverable for internal review to complete this task");
    }
    return sendConflict(res, "Invalid status transition");
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
  if (result.task.status === "completed") {
    await resolveTaskActionNotifications(result.task.id);
  }

  return res.status(200).json({ data: result.task });
});

tasksRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid task id", parsedParams.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const existingTask = await getTaskById(parsedParams.data.id);
  if (!existingTask) {
    return sendNotFound(res, "Task not found");
  }

  const canWriteTask = await hasProjectPermission({
    projectId: existingTask.project_id,
    userId: req.user.id,
    permission: "task:write"
  });
  if (!canWriteTask) {
    return logAndSendForbidden({
      req,
      res,
      permission: "task:write",
      projectId: existingTask.project_id
    });
  }

  const deleted = await deleteTask(parsedParams.data.id);
  if (!deleted) {
    return sendNotFound(res, "Task not found");
  }

  await insertActivityLog({
    userId: req.user.id,
    action: "task_deleted",
    projectId: existingTask.project_id,
    details: { taskId: existingTask.id }
  });
  await resolveTaskActionNotifications(existingTask.id, "task_deleted");

  return res.status(204).send();
});
