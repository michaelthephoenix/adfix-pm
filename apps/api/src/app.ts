import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import morgan from "morgan";
import { healthRouter } from "./routes/health.js";
import { docsRouter } from "./routes/docs.js";
import { authRouter } from "./routes/auth.js";
import { clientsRouter } from "./routes/clients.js";
import { projectsRouter } from "./routes/projects.js";
import { tasksRouter } from "./routes/tasks.js";
import { filesRouter } from "./routes/files.js";
import { analyticsRouter } from "./routes/analytics.js";
import { usersRouter } from "./routes/users.js";
import { searchRouter } from "./routes/search.js";
import { notificationsRouter } from "./routes/notifications.js";
import { clientInvitationsRouter } from "./routes/client-invitations.js";
import { clientPortalRouter } from "./routes/client-portal.js";
import { deliverablesRouter } from "./routes/deliverables.js";
import { apiRateLimiter, authRateLimiter } from "./middleware/rate-limit.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { corsMiddleware } from "./middleware/cors.js";
import { requireAuth, requireStaff } from "./middleware/auth.js";
import { env } from "./config/env.js";

morgan.token("request-id", (_req, res) => {
  const headerValue = res.getHeader("x-request-id");
  return typeof headerValue === "string" ? headerValue : "-";
});

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(requestIdMiddleware);
  app.use(corsMiddleware);
  if (process.env.NODE_ENV !== "test") {
    app.use(
      morgan(":method :url :status :res[content-length] - :response-time ms req_id=:request-id")
    );
  }
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  function mountApi(basePath: "/api" | "/api/v1") {
    app.use(basePath, healthRouter);
    app.use(basePath, docsRouter);
    app.use(`${basePath}/auth`, authRateLimiter, authRouter);
    app.use(`${basePath}/clients`, apiRateLimiter, requireAuth, requireStaff, clientsRouter);
    app.use(`${basePath}/projects`, apiRateLimiter, requireAuth, requireStaff, projectsRouter);
    app.use(`${basePath}/tasks`, apiRateLimiter, requireAuth, requireStaff, tasksRouter);
    app.use(`${basePath}/files`, apiRateLimiter, filesRouter);
    app.use(`${basePath}/analytics`, apiRateLimiter, requireAuth, requireStaff, analyticsRouter);
    app.use(`${basePath}/users`, apiRateLimiter, usersRouter);
    app.use(`${basePath}/search`, apiRateLimiter, requireAuth, requireStaff, searchRouter);
    app.use(`${basePath}/notifications`, apiRateLimiter, notificationsRouter);
    app.use(`${basePath}/client-invitations`, apiRateLimiter, clientInvitationsRouter);
    app.use(`${basePath}/client-portal`, apiRateLimiter, clientPortalRouter);
    app.use(`${basePath}/deliverables`, apiRateLimiter, deliverablesRouter);
  }

  mountApi("/api");
  mountApi("/api/v1");

  if (existsSync(env.WEB_DIST_DIR)) {
    app.use(express.static(env.WEB_DIST_DIR, { index: false }));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      return res.sendFile(path.join(env.WEB_DIST_DIR, "index.html"));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
