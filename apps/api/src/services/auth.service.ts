import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import {
  buildRefreshExpiryDate,
  hashToken,
  makeRefreshSessionId,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken
} from "../utils/tokens.js";

export type LoginResult = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string;
    isAdmin: boolean;
    accountType: "staff" | "client";
    mustChangePassword: boolean;
  };
};

export type PublicAuthResult = Omit<LoginResult, "refreshToken">;

export type RefreshAuthResult =
  | { status: "success"; session: LoginResult }
  | { status: "stale" }
  | { status: "reuse" }
  | { status: "invalid" };

const ROTATION_GRACE_MS = 10_000;

export function toPublicAuthResult(result: LoginResult): PublicAuthResult {
  return { accessToken: result.accessToken, user: result.user };
}

export async function createSessionForUser(input: {
  userId: string;
  email: string;
  name: string;
  isAdmin: boolean;
  accountType: "staff" | "client";
  authVersion: number;
  mustChangePassword: boolean;
  userAgent?: string;
  ipAddress?: string;
}): Promise<LoginResult> {
  const sessionId = makeRefreshSessionId();
  const refreshToken = signRefreshToken({ userId: input.userId, sessionId });
  const refreshTokenHash = hashToken(refreshToken);
  const refreshExpiresAt = buildRefreshExpiryDate();

  await pool.query(
    `INSERT INTO auth_sessions (
       id, user_id, refresh_token_hash, user_agent, ip_address, expires_at, token_family_id
     )
     VALUES ($1, $2, $3, $4, NULLIF($5, '')::inet, $6, $1)`,
    [sessionId, input.userId, refreshTokenHash, input.userAgent ?? null, input.ipAddress ?? null, refreshExpiresAt]
  );

  await pool.query(
    `UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [input.userId]
  );

  const accessToken = signAccessToken({
    userId: input.userId,
    email: input.email,
    name: input.name,
    isAdmin: input.isAdmin,
    accountType: input.accountType,
    authVersion: input.authVersion
  });

  return {
    accessToken,
    refreshToken,
    user: {
      id: input.userId,
      email: input.email,
      name: input.name,
      isAdmin: input.isAdmin,
      accountType: input.accountType,
      mustChangePassword: input.mustChangePassword
    }
  };
}

export async function loginWithEmailPassword(input: {
  email: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
}): Promise<LoginResult | null> {
  const userQuery = await pool.query<{
    id: string;
    email: string;
    name: string;
    is_admin: boolean;
    account_type: "staff" | "client";
    password_hash: string;
    auth_version: number;
    must_change_password: boolean;
  }>(
    `SELECT id, email, name, is_admin, account_type, password_hash,
            auth_version, must_change_password
     FROM users
     WHERE email = $1 AND deleted_at IS NULL AND is_active = TRUE
     LIMIT 1`,
    [input.email]
  );

  const user = userQuery.rows[0];
  if (!user) return null;

  const passwordMatches = await bcrypt.compare(input.password, user.password_hash);
  if (!passwordMatches) return null;

  return createSessionForUser({
    userId: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.is_admin,
    accountType: user.account_type,
    authVersion: user.auth_version,
    mustChangePassword: user.must_change_password,
    userAgent: input.userAgent,
    ipAddress: input.ipAddress
  });
}

export async function refreshAuthToken(input: {
  refreshToken: string;
  userAgent?: string;
  ipAddress?: string;
}): Promise<RefreshAuthResult> {
  let decoded;
  try {
    decoded = verifyRefreshToken(input.refreshToken);
  } catch {
    return { status: "invalid" };
  }

  if (decoded.tokenType !== "refresh") return { status: "invalid" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existingSessionQuery = await client.query<{
      id: string;
      user_id: string;
      refresh_token_hash: string;
      expires_at: Date;
      revoked_at: Date | null;
      user_agent: string | null;
      token_family_id: string;
      replaced_by_session_id: string | null;
    }>(
      `SELECT id, user_id, refresh_token_hash, expires_at, revoked_at, user_agent,
              token_family_id, replaced_by_session_id
       FROM auth_sessions
       WHERE id = $1
       LIMIT 1
       FOR UPDATE`,
      [decoded.sessionId]
    );

    const existingSession = existingSessionQuery.rows[0];
    if (!existingSession || existingSession.user_id !== decoded.userId) {
      await client.query("ROLLBACK");
      return { status: "invalid" };
    }

    const providedHash = hashToken(input.refreshToken);
    if (existingSession.refresh_token_hash !== providedHash) {
      await client.query("ROLLBACK");
      return { status: "invalid" };
    }

    if (existingSession.revoked_at !== null) {
      const rotationAge = Date.now() - new Date(existingSession.revoked_at).getTime();
      const sameClient = (existingSession.user_agent ?? "") === (input.userAgent ?? "");
      if (existingSession.replaced_by_session_id && sameClient && rotationAge <= ROTATION_GRACE_MS) {
        await client.query("ROLLBACK");
        return { status: "stale" };
      }

      await revokeTokenFamilyForReuse(client, existingSession.token_family_id);
      await client.query("COMMIT");
      return { status: "reuse" };
    }

    if (new Date(existingSession.expires_at).getTime() <= Date.now()) {
      await client.query("UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1", [existingSession.id]);
      await client.query("COMMIT");
      return { status: "invalid" };
    }

    const userQuery = await client.query<{
      id: string;
      email: string;
      name: string;
      is_admin: boolean;
      account_type: "staff" | "client";
      auth_version: number;
      must_change_password: boolean;
    }>(
      `SELECT id, email, name, is_admin, account_type, auth_version, must_change_password
       FROM users
       WHERE id = $1 AND deleted_at IS NULL AND is_active = TRUE
       LIMIT 1`,
      [decoded.userId]
    );

    const user = userQuery.rows[0];
    if (!user) {
      await client.query(
        `UPDATE auth_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
        [decoded.userId]
      );
      await client.query("COMMIT");
      return { status: "invalid" };
    }

    const newSessionId = makeRefreshSessionId();
    const refreshToken = signRefreshToken({ userId: user.id, sessionId: newSessionId });
    const refreshTokenHash = hashToken(refreshToken);
    const refreshExpiresAt = buildRefreshExpiryDate();

    await client.query(
      `INSERT INTO auth_sessions (
         id, user_id, refresh_token_hash, user_agent, ip_address, expires_at, token_family_id
       )
       VALUES ($1, $2, $3, $4, NULLIF($5, '')::inet, $6, $7)`,
      [
        newSessionId,
        user.id,
        refreshTokenHash,
        input.userAgent ?? null,
        input.ipAddress ?? null,
        refreshExpiresAt,
        existingSession.token_family_id
      ]
    );
    await client.query(
      `UPDATE auth_sessions
       SET revoked_at = NOW(), replaced_by_session_id = $2
       WHERE id = $1 AND revoked_at IS NULL`,
      [existingSession.id, newSessionId]
    );
    await client.query("COMMIT");

    const accessToken = signAccessToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      isAdmin: user.is_admin,
      accountType: user.account_type,
      authVersion: user.auth_version
    });

    return {
      status: "success",
      session: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isAdmin: user.is_admin,
          accountType: user.account_type,
          mustChangePassword: user.must_change_password
        }
      }
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function revokeTokenFamilyForReuse(client: PoolClient, tokenFamilyId: string) {
  await client.query(
    `UPDATE auth_sessions
     SET revoked_at = COALESCE(revoked_at, NOW()), reuse_detected_at = NOW()
     WHERE token_family_id = $1`,
    [tokenFamilyId]
  );
}

export async function revokeSessionByRefreshToken(refreshToken: string): Promise<void> {
  const decoded = verifyRefreshToken(refreshToken);
  if (decoded.tokenType !== "refresh") {
    throw new Error("Invalid refresh token type");
  }

  const hash = hashToken(refreshToken);

  await pool.query(
    `UPDATE auth_sessions
     SET revoked_at = NOW()
     WHERE id = $1
       AND user_id = $2
       AND revoked_at IS NULL
       AND refresh_token_hash = $3`,
    [decoded.sessionId, decoded.userId, hash]
  );
}

export async function revokeAllUserSessionsByRefreshToken(refreshToken: string): Promise<void> {
  const decoded = verifyRefreshToken(refreshToken);
  if (decoded.tokenType !== "refresh") {
    throw new Error("Invalid refresh token type");
  }

  await pool.query(
    `UPDATE auth_sessions
     SET revoked_at = NOW()
     WHERE user_id = $1
       AND revoked_at IS NULL`,
    [decoded.userId]
  );
}
