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

  app.use("/api", healthRouter);
  app.use("/api", docsRouter);
  app.use("/api/auth", authRateLimiter, authRouter);
  app.use("/api/clients", apiRateLimiter, clientsRouter);
  app.use("/api/projects", apiRateLimiter, projectsRouter);
  app.use("/api/tasks", apiRateLimiter, tasksRouter);
  app.use("/api/files", apiRateLimiter, filesRouter);
  app.use("/api/analytics", apiRateLimiter, analyticsRouter);
  app.use("/api/users", apiRateLimiter, usersRouter);
  app.use("/api/search", apiRateLimiter, searchRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
