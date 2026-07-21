import type { Request, Response } from "express";
import { env } from "../config/env.js";

export function readRefreshToken(req: Request) {
  const token = req.cookies?.[env.REFRESH_COOKIE_NAME];
  return typeof token === "string" && token.length > 0 ? token : null;
}

export function setRefreshCookie(res: Response, token: string) {
  res.cookie(env.REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "strict",
    maxAge: env.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
    path: "/api"
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(env.REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "strict",
    path: "/api"
  });
}
