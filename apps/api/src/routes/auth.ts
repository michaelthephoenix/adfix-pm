import { Router } from "express";
import { z } from "zod";
import { insertActivityLog } from "../services/activity-log.service.js";
import {
  loginWithEmailPassword,
  signupWithEmailPassword,
  refreshAuthToken,
  revokeAllUserSessionsByRefreshToken,
  revokeSessionByRefreshToken
} from "../services/auth.service.js";
import { requireAuth } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { verifyRefreshToken } from "../utils/tokens.js";
import { sendConflict, sendUnauthorized } from "../utils/http-error.js";
import { sendValidationError } from "../utils/validation.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const signupSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(255),
  password: z.string().min(8).max(128)
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1)
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid login payload", parsed.error);
  }

  const result = await loginWithEmailPassword({
    email: parsed.data.email,
    password: parsed.data.password,
    userAgent: req.header("user-agent"),
    ipAddress: req.ip
  });

  if (!result) {
    return sendUnauthorized(res, "Invalid email or password");
  }

  await insertActivityLog({
    userId: result.user.id,
    action: "auth_login",
    details: {
      email: result.user.email,
      userAgent: req.header("user-agent") ?? null,
      ipAddress: req.ip
    },
    projectId: null
  });

  return res.status(200).json(result);
});

authRouter.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid signup payload", parsed.error);
  }

  const result = await signupWithEmailPassword({
    email: parsed.data.email,
    name: parsed.data.name,
    password: parsed.data.password,
    userAgent: req.header("user-agent"),
    ipAddress: req.ip
  });

  if (result === "email_taken") {
    return sendConflict(res, "Email is already registered");
  }

  await insertActivityLog({
    userId: result.user.id,
    action: "auth_signup",
    details: {
      email: result.user.email,
      userAgent: req.header("user-agent") ?? null,
      ipAddress: req.ip
    },
    projectId: null
  });

  return res.status(201).json(result);
});

authRouter.post("/refresh", async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid refresh payload", parsed.error);
  }

  const result = await refreshAuthToken({
    refreshToken: parsed.data.refreshToken,
    userAgent: req.header("user-agent"),
    ipAddress: req.ip
  });

  if (!result) {
    return sendUnauthorized(res, "Invalid refresh token");
  }

  await insertActivityLog({
    userId: result.user.id,
    action: "auth_refresh",
    details: {
      userAgent: req.header("user-agent") ?? null,
      ipAddress: req.ip
    },
    projectId: null
  });

  return res.status(200).json(result);
});

authRouter.post("/logout", async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid logout payload", parsed.error);
  }

  try {
    const decoded = verifyRefreshToken(parsed.data.refreshToken);
    if (decoded.tokenType !== "refresh") {
      return sendUnauthorized(res, "Invalid refresh token");
    }

    await revokeSessionByRefreshToken(parsed.data.refreshToken);

    await insertActivityLog({
      userId: decoded.userId,
      action: "auth_logout",
      details: {
        sessionId: decoded.sessionId,
        userAgent: req.header("user-agent") ?? null,
        ipAddress: req.ip
      },
      projectId: null
    });
  } catch {
    return sendUnauthorized(res, "Invalid refresh token");
  }

  return res.status(204).send();
});

authRouter.post("/logout-all", async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid logout payload", parsed.error);
  }

  try {
    const decoded = verifyRefreshToken(parsed.data.refreshToken);
    if (decoded.tokenType !== "refresh") {
      return sendUnauthorized(res, "Invalid refresh token");
    }

    await revokeAllUserSessionsByRefreshToken(parsed.data.refreshToken);

    await insertActivityLog({
      userId: decoded.userId,
      action: "auth_logout_all",
      details: {
        userAgent: req.header("user-agent") ?? null,
        ipAddress: req.ip
      },
      projectId: null
    });
  } catch {
    return sendUnauthorized(res, "Invalid refresh token");
  }

  return res.status(204).send();
});

authRouter.get("/me", requireAuth, (req: AuthenticatedRequest, res) => {
  return res.status(200).json({ user: req.user });
});
