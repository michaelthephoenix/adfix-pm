import type { Request, Response } from "express";
import { env } from "../config/env.js";

export function readRefreshToken(req: Request) {
  const body = req.body as { refreshToken?: string } | undefined;
  return body?.refreshToken ?? req.cookies?.[env.REFRESH_COOKIE_NAME] ?? null;
}

export function setRefreshCookie(res: Response, token: string) {
  res.cookie(env.REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    maxAge: env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
    path: "/api"
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(env.REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: "/api"
  });
}
