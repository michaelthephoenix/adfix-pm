import { randomUUID, createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import type { SignOptions, Secret } from "jsonwebtoken";
import { env } from "../config/env.js";

export type AccessTokenPayload = {
  userId: string;
  email: string;
  name: string;
  isAdmin: boolean;
  accountType: "staff" | "client";
  authVersion: number;
  tokenType: "access";
};

export type RefreshTokenPayload = {
  userId: string;
  sessionId: string;
  tokenType: "refresh";
};

export type FilePreviewTokenPayload = {
  userId: string;
  fileId: string;
  tokenType: "file_preview";
};

export function signAccessToken(payload: Omit<AccessTokenPayload, "tokenType">): string {
  const secret: Secret = env.JWT_ACCESS_SECRET;
  const options: SignOptions = { expiresIn: env.ACCESS_TOKEN_TTL as SignOptions["expiresIn"] };

  return jwt.sign(
    { ...payload, tokenType: "access" },
    secret,
    options
  );
}

export function signRefreshToken(payload: Omit<RefreshTokenPayload, "tokenType">): string {
  const secret: Secret = env.JWT_REFRESH_SECRET;
  const options: SignOptions = {
    expiresIn: `${env.REFRESH_TOKEN_DAYS}d` as SignOptions["expiresIn"]
  };

  return jwt.sign(
    { ...payload, tokenType: "refresh" },
    secret,
    options
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
}

export function signFilePreviewToken(payload: Omit<FilePreviewTokenPayload, "tokenType">): string {
  return jwt.sign(
    { ...payload, tokenType: "file_preview" },
    env.JWT_ACCESS_SECRET,
    { expiresIn: "5m" }
  );
}

export function verifyFilePreviewToken(token: string): FilePreviewTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as FilePreviewTokenPayload;
}

export function makeRefreshSessionId(): string {
  return randomUUID();
}

export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildRefreshExpiryDate(): Date {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + env.REFRESH_TOKEN_DAYS);
  return expiresAt;
}
