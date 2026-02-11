import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/errors.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(morgan("dev"));
  app.use(express.json({ limit: "1mb" }));

  app.use("/api", healthRouter);
  app.use("/api/auth", authRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
