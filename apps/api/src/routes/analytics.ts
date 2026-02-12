import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  getDashboardAnalytics,
  getProjectsAnalytics,
  getTeamAnalytics,
  getTimelineAnalytics
} from "../services/analytics.service.js";

export const analyticsRouter = Router();

analyticsRouter.use(requireAuth);

analyticsRouter.get("/dashboard", async (_req, res) => {
  const data = await getDashboardAnalytics();
  return res.status(200).json({ data });
});

analyticsRouter.get("/projects", async (_req, res) => {
  const data = await getProjectsAnalytics();
  return res.status(200).json({ data });
});

analyticsRouter.get("/team", async (_req, res) => {
  const data = await getTeamAnalytics();
  return res.status(200).json({ data });
});

analyticsRouter.get("/timeline", async (_req, res) => {
  const data = await getTimelineAnalytics();
  return res.status(200).json({ data });
});

