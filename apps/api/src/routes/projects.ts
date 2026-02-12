import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { insertActivityLog, listProjectActivity } from "../services/activity-log.service.js";
import {
  addProjectTeamMember,
  createProject,
  deleteProject,
  getProjectDetailById,
  listProjectTeamMembers,
  listProjects,
  removeProjectTeamMember,
  transitionProjectPhase,
  updateProject
} from "../services/projects.service.js";
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
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20)
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
  role: z.string().trim().min(1).max(100)
});

projectsRouter.use(requireAuth);

projectsRouter.get("/", async (req, res) => {
  const parsed = listProjectsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid projects query", parsed.error);
  }

  const result = await listProjects(parsed.data);
  return res.status(200).json({
    data: result.rows,
    meta: {
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      total: result.total
    }
  });
});

projectsRouter.get("/:id", async (req, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid project id", parsedParams.error);
  }

  const project = await getProjectDetailById(parsedParams.data.id);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  return res.status(200).json({ data: project });
});

projectsRouter.get("/:id/activity", async (req, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid project id", parsedParams.error);
  }

  const project = await getProjectDetailById(parsedParams.data.id);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  const activity = await listProjectActivity(parsedParams.data.id);
  return res.status(200).json({ data: activity });
});

projectsRouter.get("/:id/team", async (req, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid project id", parsedParams.error);
  }

  const project = await getProjectDetailById(parsedParams.data.id);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
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
    return res.status(401).json({ error: "Unauthorized" });
  }

  const result = await addProjectTeamMember({
    projectId: parsedParams.data.id,
    userId: parsedBody.data.userId,
    role: parsedBody.data.role
  });

  if (!result.ok) {
    if (result.reason === "project_not_found") {
      return res.status(404).json({ error: "Project not found" });
    }

    return res.status(404).json({ error: "User not found" });
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

  return res.status(201).json({ data: result.member });
});

projectsRouter.delete("/:id/team/:userId", async (req: AuthenticatedRequest, res) => {
  const parsedParams = projectTeamParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid project or user id", parsedParams.error);
  }

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const deleted = await removeProjectTeamMember(parsedParams.data.id, parsedParams.data.userId);
  if (!deleted) {
    return res.status(404).json({ error: "Project team member not found" });
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
    return res.status(401).json({ error: "Unauthorized" });
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
    return res.status(401).json({ error: "Unauthorized" });
  }

  const project = await updateProject(parsedParams.data.id, parsed.data);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
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
    return res.status(401).json({ error: "Unauthorized" });
  }

  const result = await transitionProjectPhase({
    projectId: parsedParams.data.id,
    nextPhase: parsed.data.phase,
    userId: req.user.id,
    reason: parsed.data.reason ?? null
  });

  if (!result.ok) {
    if (result.reason === "not_found") {
      return res.status(404).json({ error: "Project not found" });
    }

    return res.status(409).json({ error: "Invalid phase transition. Only next forward phase is allowed." });
  }

  return res.status(200).json({ data: result.project });
});

projectsRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid project id", parsedParams.error);
  }

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const deleted = await deleteProject(parsedParams.data.id, req.user.id);
  if (!deleted) {
    return res.status(404).json({ error: "Project not found or not owned by user" });
  }

  await insertActivityLog({
    userId: req.user.id,
    action: "project_deleted",
    projectId: parsedParams.data.id,
    details: { projectId: parsedParams.data.id }
  });

  return res.status(204).send();
});
