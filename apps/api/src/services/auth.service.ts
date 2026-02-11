import bcrypt from "bcryptjs";
import { pool } from "../db/pool.js";
import {
  buildRefreshExpiryDate,
  hashToken,
  makeRefreshSessionId,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken
} from "../utils/tokens.js";

type LoginResult = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
};

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
    password_hash: string;
  }>(
    `SELECT id, email, name, password_hash
     FROM users
     WHERE email = $1 AND deleted_at IS NULL AND is_active = TRUE
     LIMIT 1`,
    [input.email]
  );

  const user = userQuery.rows[0];
  if (!user) return null;

  const passwordMatches = await bcrypt.compare(input.password, user.password_hash);
  if (!passwordMatches) return null;

  const sessionId = makeRefreshSessionId();
  const refreshToken = signRefreshToken({ userId: user.id, sessionId });
  const refreshTokenHash = hashToken(refreshToken);
  const refreshExpiresAt = buildRefreshExpiryDate();

  await pool.query(
    `INSERT INTO auth_sessions (id, user_id, refresh_token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, NULLIF($5, '')::inet, $6)`,
    [sessionId, user.id, refreshTokenHash, input.userAgent ?? null, input.ipAddress ?? null, refreshExpiresAt]
  );

  await pool.query(
    `UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [user.id]
  );

  const accessToken = signAccessToken({ userId: user.id, email: user.email, name: user.name });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name
    }
  };
}

export async function refreshAuthToken(input: {
  refreshToken: string;
  userAgent?: string;
  ipAddress?: string;
}): Promise<LoginResult | null> {
  let decoded;
  try {
    decoded = verifyRefreshToken(input.refreshToken);
  } catch {
    return null;
  }

  if (decoded.tokenType !== "refresh") return null;

  const existingSessionQuery = await pool.query<{
    id: string;
    user_id: string;
    refresh_token_hash: string;
    expires_at: Date;
    revoked_at: Date | null;
  }>(
    `SELECT id, user_id, refresh_token_hash, expires_at, revoked_at
     FROM auth_sessions
     WHERE id = $1
     LIMIT 1`,
    [decoded.sessionId]
  );

  const existingSession = existingSessionQuery.rows[0];
  if (!existingSession || existingSession.revoked_at !== null) return null;
  if (new Date(existingSession.expires_at).getTime() <= Date.now()) return null;

  const providedHash = hashToken(input.refreshToken);
  if (existingSession.refresh_token_hash !== providedHash) return null;

  const userQuery = await pool.query<{
    id: string;
    email: string;
    name: string;
  }>(
    `SELECT id, email, name
     FROM users
     WHERE id = $1 AND deleted_at IS NULL AND is_active = TRUE
     LIMIT 1`,
    [decoded.userId]
  );

  const user = userQuery.rows[0];
  if (!user) return null;

  await pool.query(`UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1`, [existingSession.id]);

  const newSessionId = makeRefreshSessionId();
  const refreshToken = signRefreshToken({ userId: user.id, sessionId: newSessionId });
  const refreshTokenHash = hashToken(refreshToken);
  const refreshExpiresAt = buildRefreshExpiryDate();

  await pool.query(
    `INSERT INTO auth_sessions (id, user_id, refresh_token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, NULLIF($5, '')::inet, $6)`,
    [newSessionId, user.id, refreshTokenHash, input.userAgent ?? null, input.ipAddress ?? null, refreshExpiresAt]
  );

  const accessToken = signAccessToken({ userId: user.id, email: user.email, name: user.name });

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name
    }
  };
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
