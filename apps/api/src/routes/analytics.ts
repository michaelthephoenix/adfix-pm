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

function escapeCsvField(value: unknown): string {
  if (value === null || typeof value === "undefined") return "";
  const stringValue = String(value);
  if (stringValue.includes(",") || stringValue.includes("\"") || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }
  return stringValue;
}

function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const headerLine = headers.join(",");
  const lines = rows.map((row) => headers.map((header) => escapeCsvField(row[header])).join(","));
  return [headerLine, ...lines].join("\n");
}

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

analyticsRouter.get("/projects.csv", async (_req, res) => {
  const data = await getProjectsAnalytics();
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

analyticsRouter.get("/team.csv", async (_req, res) => {
  const data = await getTeamAnalytics();
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
