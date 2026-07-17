import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { pool } from "../db/pool.js";
import { createSessionForUser, type LoginResult } from "./auth.service.js";
import { hashToken } from "../utils/tokens.js";
import { listProjectDeliverables } from "./deliverables.service.js";

type InvitationRow = {
  id: string;
  client_id: string;
  client_name: string;
  email: string;
  role: "reviewer" | "viewer";
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
};

export async function createClientInvitation(input: {
  clientId: string;
  email: string;
  role: "reviewer" | "viewer";
  invitedBy: string;
}) {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const result = await pool.query<InvitationRow>(
    `INSERT INTO client_invitations (client_id, email, role, token_hash, invited_by, expires_at)
     SELECT c.id, $2, $3, $4, $5, $6
     FROM clients c WHERE c.id = $1 AND c.deleted_at IS NULL
     RETURNING id, client_id,
       (SELECT name FROM clients WHERE id = client_invitations.client_id) AS client_name,
       email, role, expires_at, accepted_at, revoked_at, created_at`,
    [input.clientId, input.email.toLowerCase(), input.role, tokenHash, input.invitedBy, expiresAt]
  );

  const invitation = result.rows[0];
  return invitation ? { invitation, token: rawToken } : null;
}

export async function listClientInvitations(clientId: string) {
  const result = await pool.query<InvitationRow>(
    `SELECT ci.id, ci.client_id, c.name AS client_name, ci.email, ci.role,
       ci.expires_at, ci.accepted_at, ci.revoked_at, ci.created_at
     FROM client_invitations ci
     INNER JOIN clients c ON c.id = ci.client_id AND c.deleted_at IS NULL
     WHERE ci.client_id = $1
     ORDER BY ci.created_at DESC`,
    [clientId]
  );
  return result.rows;
}

export async function listClientAccessRecords() {
  const result = await pool.query<{
    id: string;
    kind: "membership" | "invitation";
    client_id: string;
    client_name: string;
    user_name: string | null;
    email: string;
    role: "reviewer" | "viewer";
    status: "active" | "pending" | "revoked" | "expired";
    expires_at: Date | null;
    created_at: Date;
  }>(
    `SELECT cm.user_id AS id, 'membership'::text AS kind, cm.client_id, c.name AS client_name,
       u.name AS user_name, u.email::text AS email, cm.role, 'active'::text AS status,
       NULL::timestamptz AS expires_at, cm.created_at
     FROM client_memberships cm
     INNER JOIN clients c ON c.id = cm.client_id AND c.deleted_at IS NULL
     INNER JOIN users u ON u.id = cm.user_id AND u.deleted_at IS NULL AND u.is_active = TRUE
     UNION ALL
     SELECT ci.id, 'invitation'::text AS kind, ci.client_id, c.name AS client_name,
       NULL::text AS user_name, ci.email::text AS email, ci.role,
       CASE WHEN ci.revoked_at IS NOT NULL THEN 'revoked'
            WHEN ci.expires_at <= NOW() THEN 'expired'
            ELSE 'pending' END AS status,
       ci.expires_at, ci.created_at
     FROM client_invitations ci
     INNER JOIN clients c ON c.id = ci.client_id AND c.deleted_at IS NULL
     WHERE ci.accepted_at IS NULL
     ORDER BY created_at DESC`
  );
  return result.rows;
}

export async function getInvitationByToken(token: string) {
  const result = await pool.query<InvitationRow>(
    `SELECT ci.id, ci.client_id, c.name AS client_name, ci.email, ci.role,
       ci.expires_at, ci.accepted_at, ci.revoked_at, ci.created_at
     FROM client_invitations ci
     INNER JOIN clients c ON c.id = ci.client_id AND c.deleted_at IS NULL
     WHERE ci.token_hash = $1 LIMIT 1`,
    [hashToken(token)]
  );
  const invitation = result.rows[0];
  if (!invitation) return null;
  return {
    ...invitation,
    isValid:
      !invitation.accepted_at &&
      !invitation.revoked_at &&
      new Date(invitation.expires_at).getTime() > Date.now()
  };
}

export async function revokeClientInvitation(invitationId: string) {
  const result = await pool.query<{ id: string }>(
    `UPDATE client_invitations SET revoked_at = NOW()
     WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`,
    [invitationId]
  );
  return result.rowCount === 1;
}

export async function acceptClientInvitationForNewUser(input: {
  token: string;
  name: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
}): Promise<LoginResult | "invalid" | "account_exists"> {
  const client = await pool.connect();
  let createdUser: { id: string; email: string; name: string; is_admin: boolean; account_type: "client" } | null = null;
  try {
    await client.query("BEGIN");
    const invitationResult = await client.query<InvitationRow>(
      `SELECT ci.id, ci.client_id, c.name AS client_name, ci.email, ci.role,
         ci.expires_at, ci.accepted_at, ci.revoked_at, ci.created_at
       FROM client_invitations ci
       INNER JOIN clients c ON c.id = ci.client_id AND c.deleted_at IS NULL
       WHERE ci.token_hash = $1 FOR UPDATE OF ci`,
      [hashToken(input.token)]
    );
    const invitation = invitationResult.rows[0];
    if (
      !invitation || invitation.accepted_at || invitation.revoked_at ||
      new Date(invitation.expires_at).getTime() <= Date.now()
    ) {
      await client.query("ROLLBACK");
      return "invalid";
    }

    const existing = await client.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [invitation.email]);
    if (existing.rows[0]) {
      await client.query("ROLLBACK");
      return "account_exists";
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    const userResult = await client.query<{
      id: string; email: string; name: string; is_admin: boolean; account_type: "client";
    }>(
      `INSERT INTO users (email, name, password_hash, is_active, is_admin, account_type)
       VALUES ($1, $2, $3, TRUE, FALSE, 'client')
       RETURNING id, email, name, is_admin, account_type`,
      [invitation.email, input.name, passwordHash]
    );
    createdUser = userResult.rows[0];
    await client.query(
      `INSERT INTO client_memberships (client_id, user_id, role) VALUES ($1, $2, $3)`,
      [invitation.client_id, createdUser.id, invitation.role]
    );
    await client.query("UPDATE client_invitations SET accepted_at = NOW() WHERE id = $1", [invitation.id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (!createdUser) return "invalid";
  return createSessionForUser({
    userId: createdUser.id,
    email: createdUser.email,
    name: createdUser.name,
    isAdmin: false,
    accountType: "client",
    userAgent: input.userAgent,
    ipAddress: input.ipAddress
  });
}

export async function acceptClientInvitationForExistingUser(input: {
  token: string;
  userId: string;
  email: string;
}) {
  const result = await pool.query<{ id: string }>(
    `WITH valid_invitation AS (
       SELECT id, client_id, role FROM client_invitations
       WHERE token_hash = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
     ), membership AS (
       INSERT INTO client_memberships (client_id, user_id, role)
       SELECT client_id, $3, role FROM valid_invitation
       ON CONFLICT (client_id, user_id) DO UPDATE SET role = EXCLUDED.role
       RETURNING client_id
     )
     UPDATE client_invitations SET accepted_at = NOW()
     WHERE id = (SELECT id FROM valid_invitation) AND EXISTS (SELECT 1 FROM membership)
     RETURNING id`,
    [hashToken(input.token), input.email, input.userId]
  );
  return result.rowCount === 1;
}

export async function listClientPortalProjects(userId: string) {
  const result = await pool.query<{
    id: string; client_id: string; client_name: string; name: string; description: string | null;
    current_phase: string; priority: string; start_date: string; deadline: string;
    client_role: "reviewer" | "viewer"; deliverable_count: string; pending_review_count: string;
  }>(
    `SELECT p.id, p.client_id, c.name AS client_name, cm.role AS client_role, p.name, p.description,
       p.current_phase, p.priority, p.start_date, p.deadline,
       COUNT(DISTINCT d.id)::text AS deliverable_count,
       COUNT(DISTINCT d.id) FILTER (WHERE d.status IN ('in_review', 'changes_requested'))::text AS pending_review_count
     FROM client_memberships cm
     INNER JOIN clients c ON c.id = cm.client_id AND c.deleted_at IS NULL
     INNER JOIN projects p ON p.client_id = c.id AND p.deleted_at IS NULL
     LEFT JOIN deliverables d ON d.project_id = p.id AND d.deleted_at IS NULL
     WHERE cm.user_id = $1
     GROUP BY p.id, c.name, cm.role
     ORDER BY p.updated_at DESC`,
    [userId]
  );
  return result.rows.map((row) => ({
    ...row,
    deliverable_count: Number(row.deliverable_count),
    pending_review_count: Number(row.pending_review_count)
  }));
}

export async function getClientPortalProject(projectId: string, userId: string) {
  const result = await pool.query<{
    id: string; client_id: string; client_name: string; name: string; description: string | null;
    current_phase: string; priority: string; start_date: string; deadline: string; client_role: "reviewer" | "viewer";
  }>(
    `SELECT p.id, p.client_id, c.name AS client_name, cm.role AS client_role, p.name, p.description,
       p.current_phase, p.priority, p.start_date, p.deadline
     FROM projects p
     INNER JOIN clients c ON c.id = p.client_id AND c.deleted_at IS NULL
     INNER JOIN client_memberships cm ON cm.client_id = c.id AND cm.user_id = $2
     WHERE p.id = $1 AND p.deleted_at IS NULL`,
    [projectId, userId]
  );
  const project = result.rows[0];
  if (!project) return null;
  const activity = await pool.query<{
    id: string; action: string; details: Record<string, unknown>; created_at: Date; user_name: string | null;
  }>(
    `SELECT al.id, al.action, al.details, al.created_at, u.name AS user_name
     FROM activity_log al LEFT JOIN users u ON u.id = al.user_id
     WHERE al.project_id = $1 AND al.client_visible = TRUE
     ORDER BY al.created_at DESC LIMIT 30`,
    [projectId]
  );
  return {
    ...project,
    deliverables: await listProjectDeliverables(projectId),
    activity: activity.rows
  };
}

export async function getClientVersionAccessRole(userId: string, versionId: string) {
  const result = await pool.query<{ role: "reviewer" | "viewer" }>(
    `SELECT cm.role
     FROM deliverable_versions dv
     INNER JOIN deliverables d ON d.id = dv.deliverable_id AND d.deleted_at IS NULL
     INNER JOIN projects p ON p.id = d.project_id AND p.deleted_at IS NULL
     INNER JOIN client_memberships cm ON cm.client_id = p.client_id AND cm.user_id = $1
     WHERE dv.id = $2
     LIMIT 1`,
    [userId, versionId]
  );
  return result.rows[0]?.role ?? null;
}

export async function userHasClientProjectAccess(userId: string, projectId: string) {
  const result = await pool.query<{ allowed: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM projects p
       INNER JOIN client_memberships cm ON cm.client_id = p.client_id
       WHERE p.id = $1 AND cm.user_id = $2 AND p.deleted_at IS NULL
     ) AS allowed`,
    [projectId, userId]
  );
  return result.rows[0]?.allowed === true;
}
