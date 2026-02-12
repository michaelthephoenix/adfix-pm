import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { insertActivityLog, listProjectActivity } from "../services/activity-log.service.js";
import {
  addProjectTeamMember,
  createProject,
  deleteProject,
  getProjectById,
  getProjectDetailById,
  listProjectTeamMembers,
  listProjects,
  removeProjectTeamMember,
  transitionProjectPhase,
  updateProject
} from "../services/projects.service.js";
import { hasProjectPermission } from "../services/rbac.service.js";
import { createNotification } from "../services/notifications.service.js";
import { logAndSendForbidden } from "../utils/authz.js";
import { sendConflict, sendNotFound, sendUnauthorized } from "../utils/http-error.js";
import { sendValidationError } from "../utils/validation.js";

export const projectsRouter = Router();

const projectPhaseEnum = z.enum([
  "client_acquisition",
  "strategy_planning",
  "production",
  "post_production",
  "delivery"
]);

const priorityEnum = z.enum(["low", "medium", "high", "urgent"]);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD");

const listProjectsQuerySchema = z.object({
  clientId: z.string().uuid().optional(),
  phase: projectPhaseEnum.optional(),
  priority: priorityEnum.optional(),
  deadlineFrom: isoDateSchema.optional(),
  deadlineTo: isoDateSchema.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  sortBy: z.enum(["createdAt", "updatedAt", "deadline", "name", "priority"]).optional().default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc")
});

const projectCreateSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(10000).optional().nullable(),
  currentPhase: projectPhaseEnum.optional(),
  priority: priorityEnum.optional(),
  budget: z.string().trim().max(32).optional().nullable(),
  startDate: isoDateSchema,
  deadline: isoDateSchema
});

const projectUpdateSchema = projectCreateSchema
  .omit({ currentPhase: true })
  .partial();

const projectPhasePatchSchema = z.object({
  phase: projectPhaseEnum,
  reason: z.string().trim().max(1000).optional().nullable()
});

const idParamsSchema = z.object({
  id: z.string().uuid()
});

const projectTeamParamsSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid()
});

const projectTeamAddSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(["manager", "member", "viewer"])
});

projectsRouter.use(requireAuth);

projectsRouter.get("/", async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const parsed = listProjectsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid projects query", parsed.error);
  }

  const result = await listProjects(parsed.data, req.user.id);
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

projectsRouter.get("/:id", async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid project id", parsedParams.error);
  }

  const project = await getProjectDetailById(parsedParams.data.id, req.user.id);
  if (!project) {
    return sendNotFound(res, "Project not found");
  }

  const canView = await hasProjectPermission({
    projectId: parsedParams.data.id,
    userId: req.user.id,
    permission: "project:view"
  });
  if (!canView) {
    return logAndSendForbidden({
      req,
      res,
      permission: "project:view",
      projectId: parsedParams.data.id
    });
  }

  return res.status(200).json({ data: project });
});

projectsRouter.get("/:id/activity", async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid project id", parsedParams.error);
  }

  const project = await getProjectDetailById(parsedParams.data.id, req.user.id);
  if (!project) {
    return sendNotFound(res, "Project not found");
  }

  const canView = await hasProjectPermission({
    projectId: parsedParams.data.id,
    userId: req.user.id,
    permission: "project:view"
  });
  if (!canView) {
    return logAndSendForbidden({
      req,
      res,
      permission: "project:view",
      projectId: parsedParams.data.id
    });
  }

  const activity = await listProjectActivity(parsedParams.data.id);
  return res.status(200).json({ data: activity });
});

projectsRouter.get("/:id/team", async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid project id", parsedParams.error);
  }

  const project = await getProjectDetailById(parsedParams.data.id, req.user.id);
  if (!project) {
    return sendNotFound(res, "Project not found");
  }

  const canView = await hasProjectPermission({
    projectId: parsedParams.data.id,
    userId: req.user.id,
    permission: "project:view"
  });
  if (!canView) {
    return logAndSendForbidden({
      req,
      res,
      permission: "project:view",
      projectId: parsedParams.data.id
    });
  }

  const members = await listProjectTeamMembers(parsedParams.data.id);
  return res.status(200).json({ data: members });
});

projectsRouter.post("/:id/team", async (req: AuthenticatedRequest, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid project id", parsedParams.error);
  }

  const parsedBody = projectTeamAddSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return sendValidationError(res, "Invalid team payload", parsedBody.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const project = await getProjectById(parsedParams.data.id);
  if (!project) {
    return sendNotFound(res, "Project not found");
  }

  const canManageTeam = await hasProjectPermission({
    projectId: parsedParams.data.id,
    userId: req.user.id,
    permission: "team:manage"
  });
  if (!canManageTeam) {
    return logAndSendForbidden({
      req,
      res,
      permission: "team:manage",
      projectId: parsedParams.data.id
    });
  }

  const result = await addProjectTeamMember({
    projectId: parsedParams.data.id,
    userId: parsedBody.data.userId,
    role: parsedBody.data.role
  });

  if (!result.ok) {
    if (result.reason === "project_not_found") {
      return sendNotFound(res, "Project not found");
    }

    return sendNotFound(res, "User not found");
  }

  await insertActivityLog({
    userId: req.user.id,
    action: "project_team_member_added",
    projectId: parsedParams.data.id,
    details: {
      userId: parsedBody.data.userId,
      role: parsedBody.data.role
    }
  });

  if (parsedBody.data.userId !== req.user.id) {
    await createNotification({
      userId: parsedBody.data.userId,
      projectId: parsedParams.data.id,
      type: "project_team_assigned",
      title: "Added to project",
      message: `You were added to project "${project.name}" as ${parsedBody.data.role}.`,
      metadata: {
        projectId: parsedParams.data.id,
        role: parsedBody.data.role,
        addedByUserId: req.user.id
      }
    });
  }

  return res.status(201).json({ data: result.member });
});

projectsRouter.delete("/:id/team/:userId", async (req: AuthenticatedRequest, res) => {
  const parsedParams = projectTeamParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid project or user id", parsedParams.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const project = await getProjectById(parsedParams.data.id);
  if (!project) {
    return sendNotFound(res, "Project not found");
  }

  const canManageTeam = await hasProjectPermission({
    projectId: parsedParams.data.id,
    userId: req.user.id,
    permission: "team:manage"
  });
  if (!canManageTeam) {
    return logAndSendForbidden({
      req,
      res,
      permission: "team:manage",
      projectId: parsedParams.data.id
    });
  }

  const deleted = await removeProjectTeamMember(parsedParams.data.id, parsedParams.data.userId);
  if (!deleted) {
    return sendNotFound(res, "Project team member not found");
  }

  await insertActivityLog({
    userId: req.user.id,
    action: "project_team_member_removed",
    projectId: parsedParams.data.id,
    details: {
      userId: parsedParams.data.userId
    }
  });

  return res.status(204).send();
});

projectsRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const parsed = projectCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid project payload", parsed.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const project = await createProject({
    ...parsed.data,
    createdBy: req.user.id
  });

  await insertActivityLog({
    userId: req.user.id,
    action: "project_created",
    projectId: project.id,
    details: {
      projectId: project.id,
      clientId: project.client_id,
      currentPhase: project.current_phase
    }
  });

  return res.status(201).json({ data: project });
});

projectsRouter.put("/:id", async (req: AuthenticatedRequest, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid project id", parsedParams.error);
  }

  const parsed = projectUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid project payload", parsed.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const existingProject = await getProjectById(parsedParams.data.id);
  if (!existingProject) {
    return sendNotFound(res, "Project not found");
  }

  const canUpdateProject = await hasProjectPermission({
    projectId: parsedParams.data.id,
    userId: req.user.id,
    permission: "project:update"
  });
  if (!canUpdateProject) {
    return logAndSendForbidden({
      req,
      res,
      permission: "project:update",
      projectId: parsedParams.data.id
    });
  }

  const project = await updateProject(parsedParams.data.id, parsed.data);
  if (!project) {
    return sendNotFound(res, "Project not found");
  }

  await insertActivityLog({
    userId: req.user.id,
    action: "project_updated",
    projectId: project.id,
    details: { projectId: project.id, updatedFields: Object.keys(parsed.data) }
  });

  return res.status(200).json({ data: project });
});

projectsRouter.patch("/:id/phase", async (req: AuthenticatedRequest, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid project id", parsedParams.error);
  }

  const parsed = projectPhasePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid phase payload", parsed.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const existingProject = await getProjectById(parsedParams.data.id);
  if (!existingProject) {
    return sendNotFound(res, "Project not found");
  }

  const canUpdateProject = await hasProjectPermission({
    projectId: parsedParams.data.id,
    userId: req.user.id,
    permission: "project:update"
  });
  if (!canUpdateProject) {
    return logAndSendForbidden({
      req,
      res,
      permission: "project:update",
      projectId: parsedParams.data.id
    });
  }

  const result = await transitionProjectPhase({
    projectId: parsedParams.data.id,
    nextPhase: parsed.data.phase,
    userId: req.user.id,
    reason: parsed.data.reason ?? null
  });

  if (!result.ok) {
    if (result.reason === "not_found") {
      return sendNotFound(res, "Project not found");
    }

    return sendConflict(res, "Invalid phase transition. Only next forward phase is allowed.");
  }

  return res.status(200).json({ data: result.project });
});

projectsRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid project id", parsedParams.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const existingProject = await getProjectById(parsedParams.data.id);
  if (!existingProject) {
    return sendNotFound(res, "Project not found");
  }

  const canDeleteProject = await hasProjectPermission({
    projectId: parsedParams.data.id,
    userId: req.user.id,
    permission: "project:delete"
  });
  if (!canDeleteProject) {
    return logAndSendForbidden({
      req,
      res,
      permission: "project:delete",
      projectId: parsedParams.data.id
    });
  }

  const deleted = await deleteProject(parsedParams.data.id, req.user.id);
  if (!deleted) {
    return sendNotFound(res, "Project not found or not owned by user");
  }

  await insertActivityLog({
    userId: req.user.id,
    action: "project_deleted",
    projectId: parsedParams.data.id,
    details: { projectId: parsedParams.data.id }
  });

  return res.status(204).send();
});
