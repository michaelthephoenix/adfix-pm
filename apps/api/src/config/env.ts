import { config as loadDotenv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);
const sourceApiRoot = path.resolve(currentDir, "../..");
const apiRoot = path.basename(sourceApiRoot) === "api"
  ? sourceApiRoot
  : path.resolve(currentDir, "../../..");
const envPath = path.join(apiRoot, ".env");

const developmentAccessSecret = "adfix-local-access-secret-change-for-production";
const developmentRefreshSecret = "adfix-local-refresh-secret-change-for-production";
const developmentAdminEmail = "admin@adfix.local";
const developmentAdminName = "Adfix Admin";
const developmentAdminPassword = "ChangeMe123!";

loadDotenv({ path: envPath });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1).optional(),
  PGLITE_DATA_DIR: z.string().min(1).default(path.join(apiRoot, ".data", "pglite")),
  LOCAL_UPLOAD_DIR: z.string().min(1).default(path.join(apiRoot, ".data", "uploads")),
  WEB_DIST_DIR: z.string().min(1).default(path.resolve(apiRoot, "../web/dist")),
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),
  REFRESH_COOKIE_NAME: z.string().min(1).default("adfix_refresh"),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  JWT_ACCESS_SECRET: z.string().min(32).default(developmentAccessSecret),
  JWT_REFRESH_SECRET: z.string().min(32).default(developmentRefreshSecret),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  REFRESH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  REFRESH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  API_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  API_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:3000,http://localhost:4000,http://localhost:5173"),
  SEED_PROFILE: z.enum(["admin_only", "demo"]).default("admin_only"),
  SEED_ADMIN_EMAIL: z.string().email().default(developmentAdminEmail),
  SEED_ADMIN_NAME: z.string().trim().min(1).max(255).default(developmentAdminName),
  SEED_ADMIN_PASSWORD: z.string().min(12).max(128).optional(),
  SEED_DEMO_USER_PASSWORD: z.string().min(12).max(128).default("DemoUser123!")
}).superRefine((values, context) => {
  if (values.NODE_ENV !== "production") return;

  if (
    values.JWT_ACCESS_SECRET === developmentAccessSecret ||
    values.JWT_ACCESS_SECRET.startsWith("replace-with-")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JWT_ACCESS_SECRET"],
      message: "Set a production JWT access secret"
    });
  }

  if (
    values.JWT_REFRESH_SECRET === developmentRefreshSecret ||
    values.JWT_REFRESH_SECRET.startsWith("replace-with-")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JWT_REFRESH_SECRET"],
      message: "Set a production JWT refresh secret"
    });
  }

  if (values.JWT_ACCESS_SECRET === values.JWT_REFRESH_SECRET) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JWT_REFRESH_SECRET"],
      message: "Access and refresh tokens must use different secrets"
    });
  }

  if (!values.COOKIE_SECURE) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["COOKIE_SECURE"],
      message: "Production refresh cookies must be secure"
    });
  }

  if (!values.APP_ORIGIN.startsWith("https://")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["APP_ORIGIN"],
      message: "Production APP_ORIGIN must use HTTPS"
    });
  }

  if (values.CORS_ALLOWED_ORIGINS.split(",").some((origin) => origin.trim() === "*")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CORS_ALLOWED_ORIGINS"],
      message: "Wildcard CORS origins cannot be used with authenticated production requests"
    });
  }

  if (values.SEED_PROFILE === "demo") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SEED_PROFILE"],
      message: "The demo seed profile cannot run in production"
    });
  }

  if (
    values.SEED_ADMIN_PASSWORD === developmentAdminPassword ||
    values.SEED_ADMIN_PASSWORD?.startsWith("replace-with-")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SEED_ADMIN_PASSWORD"],
      message: "Use a strong unique password when bootstrapping a production administrator"
    });
  }
});

export const env = envSchema.parse(process.env);
