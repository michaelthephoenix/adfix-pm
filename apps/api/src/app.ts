import express from "express";
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
import { apiRateLimiter, authRateLimiter } from "./middleware/rate-limit.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";
import { requestIdMiddleware } from "./middleware/request-id.js";

morgan.token("request-id", (_req, res) => {
  const headerValue = res.getHeader("x-request-id");
  return typeof headerValue === "string" ? headerValue : "-";
});

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(requestIdMiddleware);
  if (process.env.NODE_ENV !== "test") {
    app.use(
      morgan(":method :url :status :res[content-length] - :response-time ms req_id=:request-id")
    );
  }
  app.use(express.json({ limit: "1mb" }));

  function mountApi(basePath: "/api" | "/api/v1") {
    app.use(basePath, healthRouter);
    app.use(basePath, docsRouter);
    app.use(`${basePath}/auth`, authRateLimiter, authRouter);
    app.use(`${basePath}/clients`, apiRateLimiter, clientsRouter);
    app.use(`${basePath}/projects`, apiRateLimiter, projectsRouter);
    app.use(`${basePath}/tasks`, apiRateLimiter, tasksRouter);
    app.use(`${basePath}/files`, apiRateLimiter, filesRouter);
    app.use(`${basePath}/analytics`, apiRateLimiter, analyticsRouter);
    app.use(`${basePath}/users`, apiRateLimiter, usersRouter);
    app.use(`${basePath}/search`, apiRateLimiter, searchRouter);
  }

  mountApi("/api");
  mountApi("/api/v1");

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
