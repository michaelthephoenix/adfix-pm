import { Router } from "express";
import { z } from "zod";
import { insertActivityLog } from "../services/activity-log.service.js";
import {
  loginWithEmailPassword,
  refreshAuthToken,
  revokeAllUserSessionsByRefreshToken,
  revokeSessionByRefreshToken,
  toPublicAuthResult
} from "../services/auth.service.js";
import { requireAuth } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { verifyRefreshToken } from "../utils/tokens.js";
import { sendError, sendUnauthorized } from "../utils/http-error.js";
import { sendValidationError } from "../utils/validation.js";
import { clearRefreshCookie, readRefreshToken, setRefreshCookie } from "../utils/auth-cookie.js";
import { loginRateLimiter, refreshRateLimiter } from "../middleware/rate-limit.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const emptyBodySchema = z.object({}).strict().default({});

authRouter.post("/login", loginRateLimiter, async (req, res) => {
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

  setRefreshCookie(res, result.refreshToken);

  return res.status(200).json(toPublicAuthResult(result));
});

authRouter.post("/refresh", refreshRateLimiter, async (req, res) => {
  const parsed = emptyBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return sendValidationError(res, "Invalid refresh payload", parsed.error);
  }

  const refreshToken = readRefreshToken(req);
  if (!refreshToken) {
    clearRefreshCookie(res);
    return sendUnauthorized(res, "Missing refresh cookie");
  }

  const result = await refreshAuthToken({
    refreshToken,
    userAgent: req.header("user-agent"),
    ipAddress: req.ip
  });

  if (result.status === "stale") {
    return sendError(
      res,
      409,
      "REFRESH_ALREADY_ROTATED",
      "This refresh token was already rotated; retry with the current cookie"
    );
  }

  if (result.status !== "success") {
    clearRefreshCookie(res);
    return sendUnauthorized(res, "Invalid refresh token");
  }

  const session = result.session;

  await insertActivityLog({
    userId: session.user.id,
    action: "auth_refresh",
    details: {
      userAgent: req.header("user-agent") ?? null,
      ipAddress: req.ip
    },
    projectId: null
  });

  setRefreshCookie(res, session.refreshToken);

  return res.status(200).json(toPublicAuthResult(session));
});

authRouter.post("/logout", async (req, res) => {
  const parsed = emptyBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return sendValidationError(res, "Invalid logout payload", parsed.error);
  }

  const refreshToken = readRefreshToken(req);
  clearRefreshCookie(res);
  if (!refreshToken) return res.status(204).send();

  try {
    const decoded = verifyRefreshToken(refreshToken);
    if (decoded.tokenType !== "refresh") {
      return res.status(204).send();
    }

    await revokeSessionByRefreshToken(refreshToken);

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
    return res.status(204).send();
  }

  return res.status(204).send();
});

authRouter.post("/logout-all", async (req, res) => {
  const parsed = emptyBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return sendValidationError(res, "Invalid logout payload", parsed.error);
  }

  const refreshToken = readRefreshToken(req);
  clearRefreshCookie(res);
  if (!refreshToken) return res.status(204).send();

  try {
    const decoded = verifyRefreshToken(refreshToken);
    if (decoded.tokenType !== "refresh") {
      return res.status(204).send();
    }

    await revokeAllUserSessionsByRefreshToken(refreshToken);

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
    return res.status(204).send();
  }

  return res.status(204).send();
});

authRouter.get("/me", requireAuth, (req: AuthenticatedRequest, res) => {
  return res.status(200).json({ user: req.user });
});
