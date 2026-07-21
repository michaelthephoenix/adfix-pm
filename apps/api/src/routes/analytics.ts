import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../types/http.js";
import {
  getDashboardAnalytics,
  getProjectsAnalytics,
  getTeamAnalytics,
  getTimelineAnalytics
} from "../services/analytics.service.js";
import { sendUnauthorized } from "../utils/http-error.js";
import { toCsv } from "../utils/csv.js";

export const analyticsRouter = Router();

analyticsRouter.use(requireAuth);

analyticsRouter.get("/dashboard", async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const data = await getDashboardAnalytics(req.user.id);
  return res.status(200).json({ data });
});

analyticsRouter.get("/projects", async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const data = await getProjectsAnalytics(req.user.id);
  return res.status(200).json({ data });
});

analyticsRouter.get("/team", async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const data = await getTeamAnalytics(req.user.id);
  return res.status(200).json({ data });
});

analyticsRouter.get("/timeline", async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const data = await getTimelineAnalytics(req.user.id);
  return res.status(200).json({ data });
});

analyticsRouter.get("/projects.csv", async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const data = await getProjectsAnalytics(req.user.id);
  const headers = [
    "projectId",
    "projectName",
    "currentPhase",
    "totalTasks",
    "completedTasks",
    "completionRatePct"
  ];
  const csv = toCsv(headers, data as unknown as Record<string, unknown>[]);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=\"projects-analytics.csv\"");
  return res.status(200).send(csv);
});

analyticsRouter.get("/team.csv", async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const data = await getTeamAnalytics(req.user.id);
  const headers = [
    "userId",
    "userName",
    "userEmail",
    "totalTasks",
    "completedTasks",
    "overdueTasks"
  ];
  const csv = toCsv(headers, data as unknown as Record<string, unknown>[]);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=\"team-analytics.csv\"");
  return res.status(200).send(csv);
});
