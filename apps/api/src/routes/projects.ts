import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { insertActivityLog } from "../services/activity-log.service.js";
import {
  createProject,
  deleteProject,
  getProjectDetailById,
  listProjects,
  transitionProjectPhase,
  updateProject
} from "../services/projects.service.js";

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
  deadlineTo: isoDateSchema.optional()
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

projectsRouter.use(requireAuth);

projectsRouter.get("/", async (req, res) => {
  const parsed = listProjectsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid projects query" });
  }

  const projects = await listProjects(parsed.data);
  return res.status(200).json({ data: projects });
});

projectsRouter.get("/:id", async (req, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({ error: "Invalid project id" });
  }

  const project = await getProjectDetailById(parsedParams.data.id);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  return res.status(200).json({ data: project });
});

projectsRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const parsed = projectCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid project payload" });
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
    return res.status(400).json({ error: "Invalid project id" });
  }

  const parsed = projectUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid project payload" });
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
    return res.status(400).json({ error: "Invalid project id" });
  }

  const parsed = projectPhasePatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid phase payload" });
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
    return res.status(400).json({ error: "Invalid project id" });
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
