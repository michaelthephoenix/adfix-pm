import { Router } from "express";
import { z } from "zod";
import { insertActivityLog } from "../services/activity-log.service.js";
import {
  loginWithEmailPassword,
  refreshAuthToken,
  revokeAllUserSessionsByRefreshToken,
  revokeSessionByRefreshToken
} from "../services/auth.service.js";
import { requireAuth } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { verifyRefreshToken } from "../utils/tokens.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1)
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid login payload" });
  }

  const result = await loginWithEmailPassword({
    email: parsed.data.email,
    password: parsed.data.password,
    userAgent: req.header("user-agent"),
    ipAddress: req.ip
  });

  if (!result) {
    return res.status(401).json({ error: "Invalid email or password" });
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

authRouter.post("/refresh", async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid refresh payload" });
  }

  const result = await refreshAuthToken({
    refreshToken: parsed.data.refreshToken,
    userAgent: req.header("user-agent"),
    ipAddress: req.ip
  });

  if (!result) {
    return res.status(401).json({ error: "Invalid refresh token" });
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
    return res.status(400).json({ error: "Invalid logout payload" });
  }

  try {
    const decoded = verifyRefreshToken(parsed.data.refreshToken);
    if (decoded.tokenType !== "refresh") {
      return res.status(401).json({ error: "Invalid refresh token" });
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
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  return res.status(204).send();
});

authRouter.post("/logout-all", async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid logout payload" });
  }

  try {
    const decoded = verifyRefreshToken(parsed.data.refreshToken);
    if (decoded.tokenType !== "refresh") {
      return res.status(401).json({ error: "Invalid refresh token" });
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
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  return res.status(204).send();
});

authRouter.get("/me", requireAuth, (req: AuthenticatedRequest, res) => {
  return res.status(200).json({ user: req.user });
});
