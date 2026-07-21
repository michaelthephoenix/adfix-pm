import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireStaff } from "../middleware/auth.js";
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
  updateProjectTeamMemberRole,
  transitionProjectPhase,
  updateProject,
  ProjectClientLockedError
} from "../services/projects.service.js";
import { hasProjectPermission } from "../services/rbac.service.js";
import { createProjectSetup } from "../services/project-setup.service.js";
import { createNotificationsForUsers } from "../services/notifications.service.js";
import { storageProvider } from "../storage/local-storage.js";
import { logAndSendForbidden } from "../utils/authz.js";
import { sendConflict, sendError, sendNotFound, sendUnauthorized } from "../utils/http-error.js";
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

const projectSetupSchema = z.object({
  clientId: z.string().uuid().optional(),
  newClient: z.object({
    name: z.string().trim().min(1).max(255),
    company: z.string().trim().max(255).optional().nullable()
  }).optional(),
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(10000).optional().nullable(),
  priority: priorityEnum.optional(),
  budget: z.string().trim().max(32).optional().nullable(),
  startDate: isoDateSchema,
  deadline: isoDateSchema,
  team: z.array(z.object({
    userId: z.string().uuid(),
    role: z.enum(["manager", "member", "viewer"])
  })).max(100).optional().default([])
}).superRefine((value, context) => {
  if (Boolean(value.clientId) === Boolean(value.newClient)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["clientId"],
      message: "Choose one existing client or create one new client"
    });
  }
  if (value.deadline < value.startDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["deadline"],
      message: "Deadline must be on or after the start date"
    });
  }
});

const projectUpdateSchema = projectCreateSchema
  .omit({ currentPhase: true })
  .partial();

const projectPhasePatchSchema = z.object({
  phase: projectPhaseEnum,
  reason: z.string().trim().max(1000).optional().nullable(),
  clientUpdate: z.string().trim().max(2000).optional().nullable(),
  confirmUnresolvedReviews: z.boolean().optional().default(false)
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

projectsRouter.post("/setup", requireStaff, async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const parsed = projectSetupSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid project setup payload", parsed.error);
  }

  const result = await createProjectSetup({
    ...parsed.data,
    createdBy: req.user.id
  });
  if (!result.ok) {
    if (result.reason === "client_not_found") {
      return sendNotFound(res, "Client not found");
    }
    return sendError(
      res,
      422,
      "INVALID_TEAM_MEMBERS",
      "Every project team member must be an active staff account",
      { userIds: result.userIds }
    );
  }

  return res.status(201).json({
    data: result.project,
    meta: {
      clientCreated: result.clientCreated,
      assignedTeamMemberCount: result.teamUserIds.length
    }
  });
});

const projectTeamRoleSchema = z.object({
  role: z.enum(["manager", "member", "viewer"])
});

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
    const assignmentTimestamp = new Date(result.member.created_at).toISOString();
    await createNotificationsForUsers([parsedBody.data.userId], {
      projectId: parsedParams.data.id,
      type: "project_team_assigned",
      title: "Added to project",
      message: `You were added to project "${project.name}" as ${parsedBody.data.role}.`,
      metadata: {
        projectId: parsedParams.data.id,
        role: parsedBody.data.role,
        href: `/projects/${parsedParams.data.id}?tab=tasks`
      }
    }, {
      eventKey: `project:${parsedParams.data.id}:team:${parsedBody.data.userId}:${assignmentTimestamp}:${parsedBody.data.role}`
    });
  }

  return res.status(201).json({ data: result.member });
});

projectsRouter.patch("/:id/team/:userId", async (req: AuthenticatedRequest, res) => {
  const parsedParams = projectTeamParamsSchema.safeParse(req.params);
  if (!parsedParams.success) return sendValidationError(res, "Invalid project or user id", parsedParams.error);
  const parsedBody = projectTeamRoleSchema.safeParse(req.body);
  if (!parsedBody.success) return sendValidationError(res, "Invalid team role payload", parsedBody.error);
  if (!req.user) return sendUnauthorized(res, "Unauthorized");

  const project = await getProjectById(parsedParams.data.id);
  if (!project) return sendNotFound(res, "Project not found");
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

  const previous = (await listProjectTeamMembers(parsedParams.data.id))
    .find((member) => member.user_id === parsedParams.data.userId);
  if (!previous || previous.role === "owner") return sendNotFound(res, "Project team member not found");

  const result = await updateProjectTeamMemberRole({
    projectId: parsedParams.data.id,
    userId: parsedParams.data.userId,
    role: parsedBody.data.role
  });
  if (!result.ok) {
    if (result.reason === "last_supervisor") {
      return sendConflict(res, "Assign another active project supervisor before changing this role");
    }
    return sendNotFound(res, "Project team member not found");
  }

  await insertActivityLog({
    userId: req.user.id,
    action: "project_team_role_changed",
    projectId: parsedParams.data.id,
    details: { userId: parsedParams.data.userId, from: previous.role, to: parsedBody.data.role }
  });
  if (parsedParams.data.userId !== req.user.id) {
    await createNotificationsForUsers([parsedParams.data.userId], {
      projectId: parsedParams.data.id,
      type: "project_team_role_changed",
      title: "Project role updated",
      message: `Your role on project "${project.name}" changed to ${parsedBody.data.role}.`,
      metadata: {
        projectId: parsedParams.data.id,
        role: parsedBody.data.role,
        changedByUserId: req.user.id,
        href: `/projects/${parsedParams.data.id}?tab=team`
      }
    }, {
      eventKey: `project:${parsedParams.data.id}:team-role:${parsedParams.data.userId}:${Date.now()}`,
      excludeUserIds: [req.user.id]
    });
  }
  return res.status(200).json({ data: result.member });
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
  if (!deleted.ok) {
    if (deleted.reason === "last_supervisor") {
      return sendConflict(res, "Assign another active project supervisor before removing this member");
    }
    if (deleted.reason === "assigned_tasks") {
      return sendConflict(res, "Reassign this member's project tasks before removing them from the team");
    }
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

  let project;
  try {
    project = await updateProject(parsedParams.data.id, parsed.data);
  } catch (error) {
    if (error instanceof ProjectClientLockedError) return sendConflict(res, error.message);
    throw error;
  }
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
  const actorUserId = req.user.id;

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
    reason: parsed.data.reason ?? null,
    clientUpdate: parsed.data.clientUpdate ?? null,
    confirmUnresolvedReviews: parsed.data.confirmUnresolvedReviews
  });

  if (!result.ok) {
    if (result.reason === "not_found") {
      return sendNotFound(res, "Project not found");
    }

    if (result.reason === "delivery_confirmation_required") {
      return sendError(
        res,
        409,
        "DELIVERY_CONFIRMATION_REQUIRED",
        "Unresolved reviews or incomplete tasks remain. Confirm that Delivery should close review actions and continue.",
        {
          unresolvedReviews: result.unresolvedReviews ?? 0,
          incompleteTasks: result.incompleteTasks ?? 0
        }
      );
    }

    return sendConflict(res, "Invalid phase transition. Only next forward phase is allowed.");
  }

  const teamMembers = await listProjectTeamMembers(parsedParams.data.id);
  const recipients = teamMembers.filter((member) => member.user_id !== req.user?.id);

  if (recipients.length > 0) {
    await createNotificationsForUsers(recipients.map((member) => member.user_id), {
      projectId: parsedParams.data.id,
      type: "project_milestone_reached",
      title: "Project milestone reached",
      message: `Project "${result.project.name}" advanced to ${parsed.data.phase}.`,
      metadata: {
        projectId: parsedParams.data.id,
        fromPhase: existingProject.current_phase,
        toPhase: parsed.data.phase,
        changedByUserId: actorUserId
      }
    }, {
      eventKey: `project:${parsedParams.data.id}:phase:${parsed.data.phase}`,
      excludeUserIds: [req.user.id]
    });
  }

  return res.status(200).json({ data: result.project, meta: { warnings: result.warnings } });
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
  if (!deleted.ok) {
    if (deleted.reason === "delivery_locked") {
      return sendConflict(res, "Delivery projects are retained as immutable history and cannot be deleted");
    }
    if (deleted.reason === "deliverable_history_exists") {
      return sendConflict(res, "Projects with submitted deliverable versions cannot be deleted; archive them instead");
    }
    return sendNotFound(res, "Project not found or not owned by user");
  }

  await insertActivityLog({
    userId: req.user.id,
    action: "project_deleted",
    projectId: parsedParams.data.id,
    details: { projectId: parsedParams.data.id }
  });

  const deletionResults = await Promise.allSettled(
    deleted.localObjectKeys.map((objectKey) => storageProvider.delete(objectKey))
  );
  const failedObjectCleanupCount = deletionResults.filter((result) => result.status === "rejected").length;
  if (failedObjectCleanupCount > 0) {
    console.error("Project deleted but local object cleanup was incomplete", {
      projectId: parsedParams.data.id,
      failedObjectCleanupCount
    });
  }

  return res.status(204).send();
});
