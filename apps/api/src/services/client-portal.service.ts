import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { pool } from "../db/pool.js";
import { createSessionForUser, type LoginResult } from "./auth.service.js";
import { hashToken } from "../utils/tokens.js";
import { listProjectDeliverables } from "./deliverables.service.js";
import { enqueueNotificationEvent } from "./notifications.service.js";

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

export type ClientAccessRole = "reviewer" | "viewer";

type AcceptedInvitation = {
  invitationId: string;
  clientId: string;
  clientName: string;
  role: ClientAccessRole;
};

export async function createClientInvitation(input: {
  clientId: string;
  email: string;
  role: ClientAccessRole;
  invitedBy: string;
}) {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const email = input.email.toLowerCase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const clientResult = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM clients WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [input.clientId]
    );
    const clientRecord = clientResult.rows[0];
    if (!clientRecord) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "client_not_found" as const };
    }

    await client.query(
      `UPDATE client_invitations
       SET revoked_at = NOW()
       WHERE client_id = $1 AND email = $2 AND accepted_at IS NULL
         AND revoked_at IS NULL AND expires_at <= NOW()`,
      [input.clientId, email]
    );

    const existingUser = await client.query<{
      id: string; account_type: "staff" | "client"; is_active: boolean;
    }>(
      `SELECT id, account_type, is_active FROM users WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
      [email]
    );
    if (existingUser.rows[0]?.account_type === "staff") {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "staff_email" as const };
    }
    if (existingUser.rows[0] && !existingUser.rows[0].is_active) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "inactive_account" as const };
    }
    if (existingUser.rows[0]) {
      const membership = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM client_memberships WHERE client_id = $1 AND user_id = $2
         ) AS exists`,
        [input.clientId, existingUser.rows[0].id]
      );
      if (membership.rows[0]?.exists) {
        await client.query("ROLLBACK");
        return { ok: false as const, reason: "already_member" as const };
      }
    }

    const pending = await client.query<{ id: string }>(
      `SELECT id FROM client_invitations
       WHERE client_id = $1 AND email = $2 AND accepted_at IS NULL
         AND revoked_at IS NULL AND expires_at > NOW()
       LIMIT 1`,
      [input.clientId, email]
    );
    if (pending.rows[0]) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "already_invited" as const };
    }

    const result = await client.query<InvitationRow>(
      `INSERT INTO client_invitations (client_id, email, role, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, client_id, $7::text AS client_name,
         email, role, expires_at, accepted_at, revoked_at, created_at`,
      [input.clientId, email, input.role, tokenHash, input.invitedBy, expiresAt, clientRecord.name]
    );
    const invitation = result.rows[0];
    await client.query(
      `INSERT INTO activity_log (project_id, user_id, action, details, client_visible, created_at)
       VALUES (NULL, $1, 'client_invitation_created', $2::jsonb, FALSE, NOW())`,
      [input.invitedBy, JSON.stringify({
        invitationId: invitation.id,
        clientId: invitation.client_id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expires_at
      })]
    );
    await client.query("COMMIT");
    return { ok: true as const, invitation, token: rawToken };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
  const accountResult = await pool.query<{ account_exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM users WHERE email = $1 AND deleted_at IS NULL
     ) AS account_exists`,
    [invitation.email]
  );
  return {
    ...invitation,
    accountExists: accountResult.rows[0]?.account_exists === true,
    isValid:
      !invitation.accepted_at &&
      !invitation.revoked_at &&
      new Date(invitation.expires_at).getTime() > Date.now()
  };
}

export async function revokeClientInvitation(input: { invitationId: string; revokedBy: string }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      id: string; client_id: string; email: string; role: ClientAccessRole;
    }>(
      `UPDATE client_invitations SET revoked_at = NOW()
       WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
       RETURNING id, client_id, email, role`,
      [input.invitationId]
    );
    const invitation = result.rows[0];
    if (!invitation) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      `INSERT INTO activity_log (project_id, user_id, action, details, client_visible, created_at)
       VALUES (NULL, $1, 'client_invitation_revoked', $2::jsonb, FALSE, NOW())`,
      [input.revokedBy, JSON.stringify({
        invitationId: invitation.id,
        clientId: invitation.client_id,
        email: invitation.email,
        role: invitation.role
      })]
    );
    await client.query("COMMIT");
    return invitation;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function acceptClientInvitationForNewUser(input: {
  token: string;
  name: string;
  password: string;
  userAgent?: string;
  ipAddress?: string;
}): Promise<(LoginResult & { acceptedInvitation: AcceptedInvitation }) | "invalid" | "account_exists"> {
  const client = await pool.connect();
  let createdUser: {
    id: string;
    email: string;
    name: string;
    is_admin: boolean;
    account_type: "client";
    auth_version: number;
    must_change_password: boolean;
  } | null = null;
  let acceptedInvitation: AcceptedInvitation | null = null;
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
      auth_version: number; must_change_password: boolean;
    }>(
      `INSERT INTO users (email, name, password_hash, is_active, is_admin, account_type)
       VALUES ($1, $2, $3, TRUE, FALSE, 'client')
       RETURNING id, email, name, is_admin, account_type, auth_version, must_change_password`,
      [invitation.email, input.name, passwordHash]
    );
    createdUser = userResult.rows[0];
    await client.query(
      `INSERT INTO client_memberships (client_id, user_id, role) VALUES ($1, $2, $3)`,
      [invitation.client_id, createdUser.id, invitation.role]
    );
    await client.query("UPDATE client_invitations SET accepted_at = NOW() WHERE id = $1", [invitation.id]);
    acceptedInvitation = {
      invitationId: invitation.id,
      clientId: invitation.client_id,
      clientName: invitation.client_name,
      role: invitation.role
    };
    await client.query(
      `INSERT INTO activity_log (project_id, user_id, action, details, client_visible, created_at)
       VALUES (NULL, $1, 'client_invitation_accepted', $2::jsonb, FALSE, NOW())`,
      [createdUser.id, JSON.stringify({
        invitationId: invitation.id,
        clientId: invitation.client_id,
        role: invitation.role,
        accountCreated: true
      })]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (!createdUser || !acceptedInvitation) return "invalid";
  const session = await createSessionForUser({
    userId: createdUser.id,
    email: createdUser.email,
    name: createdUser.name,
    isAdmin: false,
    accountType: "client",
    authVersion: createdUser.auth_version,
    mustChangePassword: createdUser.must_change_password,
    userAgent: input.userAgent,
    ipAddress: input.ipAddress
  });
  return { ...session, acceptedInvitation };
}

export async function acceptClientInvitationForExistingUser(input: {
  token: string;
  userId: string;
  email: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<InvitationRow>(
      `SELECT ci.id, ci.client_id, c.name AS client_name, ci.email, ci.role,
         ci.expires_at, ci.accepted_at, ci.revoked_at, ci.created_at
       FROM client_invitations ci
       INNER JOIN clients c ON c.id = ci.client_id AND c.deleted_at IS NULL
       WHERE ci.token_hash = $1
       FOR UPDATE OF ci`,
      [hashToken(input.token)]
    );
    const invitation = result.rows[0];
    if (
      !invitation || invitation.accepted_at || invitation.revoked_at ||
      new Date(invitation.expires_at).getTime() <= Date.now()
    ) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "invalid" as const };
    }
    if (invitation.email.toLowerCase() !== input.email.toLowerCase()) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "email_mismatch" as const };
    }

    await client.query(
      `INSERT INTO client_memberships (client_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (client_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
      [invitation.client_id, input.userId, invitation.role]
    );
    await client.query("UPDATE client_invitations SET accepted_at = NOW() WHERE id = $1", [invitation.id]);
    await client.query(
      `INSERT INTO activity_log (project_id, user_id, action, details, client_visible, created_at)
       VALUES (NULL, $1, 'client_invitation_accepted', $2::jsonb, FALSE, NOW())`,
      [input.userId, JSON.stringify({
        invitationId: invitation.id,
        clientId: invitation.client_id,
        role: invitation.role,
        accountCreated: false
      })]
    );
    await client.query("COMMIT");
    return {
      ok: true as const,
      acceptedInvitation: {
        invitationId: invitation.id,
        clientId: invitation.client_id,
        clientName: invitation.client_name,
        role: invitation.role
      }
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateClientMembershipRole(input: {
  clientId: string;
  userId: string;
  role: ClientAccessRole;
  updatedBy: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      client_id: string; user_id: string; role: ClientAccessRole; email: string; user_name: string;
    }>(
      `UPDATE client_memberships membership
       SET role = $3
       FROM users user_account
       WHERE membership.client_id = $1 AND membership.user_id = $2
         AND user_account.id = membership.user_id
       RETURNING membership.client_id, membership.user_id, membership.role,
         user_account.email::text AS email, user_account.name AS user_name`,
      [input.clientId, input.userId, input.role]
    );
    const membership = result.rows[0];
    if (!membership) {
      await client.query("ROLLBACK");
      return null;
    }
    const auditResult = await client.query<{ id: string }>(
      `INSERT INTO activity_log (project_id, user_id, action, details, client_visible, created_at)
       VALUES (NULL, $1, 'client_access_role_changed', $2::jsonb, FALSE, NOW())
       RETURNING id`,
      [input.updatedBy, JSON.stringify({
        clientId: membership.client_id,
        targetUserId: membership.user_id,
        email: membership.email,
        role: membership.role
      })]
    );
    await enqueueNotificationEvent(
      client,
      `client-access-change:${auditResult.rows[0].id}`,
      [membership.user_id],
      {
        type: "client_access_role_changed",
        title: "Client portal access updated",
        message: `Your portal access is now ${membership.role === "reviewer" ? "Reviewer" : "Viewer"}.`,
        metadata: { clientId: membership.client_id, role: membership.role, href: "/portal/projects" }
      }
    );
    await client.query("COMMIT");
    return { ...membership, change_id: auditResult.rows[0].id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeClientMembership(input: {
  clientId: string;
  userId: string;
  revokedBy: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      client_id: string; user_id: string; role: ClientAccessRole; email: string; user_name: string;
    }>(
      `DELETE FROM client_memberships membership
       USING users user_account
       WHERE membership.client_id = $1 AND membership.user_id = $2
         AND user_account.id = membership.user_id
       RETURNING membership.client_id, membership.user_id, membership.role,
         user_account.email::text AS email, user_account.name AS user_name`,
      [input.clientId, input.userId]
    );
    const membership = result.rows[0];
    if (!membership) {
      await client.query("ROLLBACK");
      return null;
    }
    const auditResult = await client.query<{ id: string }>(
      `INSERT INTO activity_log (project_id, user_id, action, details, client_visible, created_at)
       VALUES (NULL, $1, 'client_access_revoked', $2::jsonb, FALSE, NOW())
       RETURNING id`,
      [input.revokedBy, JSON.stringify({
        clientId: membership.client_id,
        targetUserId: membership.user_id,
        email: membership.email,
        previousRole: membership.role
      })]
    );
    await enqueueNotificationEvent(
      client,
      `client-access-change:${auditResult.rows[0].id}`,
      [membership.user_id],
      {
        type: "client_access_revoked",
        title: "Client portal access removed",
        message: "Your access to this client organization has been removed.",
        metadata: { clientId: membership.client_id, href: "/portal/projects" }
      }
    );
    await client.query("COMMIT");
    return { ...membership, change_id: auditResult.rows[0].id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listClientPortalProjects(userId: string) {
  const result = await pool.query<{
    id: string; client_id: string; client_name: string; name: string; description: string | null;
    current_phase: string; priority: string; start_date: string; deadline: string;
    client_role: "reviewer" | "viewer"; deliverable_count: string; pending_review_count: string;
  }>(
    `SELECT p.id, p.client_id, c.name AS client_name, cm.role AS client_role, p.name, p.description,
       p.current_phase, p.priority, p.start_date, p.deadline,
       COUNT(DISTINCT d.id) FILTER (WHERE EXISTS (
         SELECT 1 FROM deliverable_versions visible_version
         WHERE visible_version.deliverable_id = d.id
           AND visible_version.client_submitted_at IS NOT NULL
           AND visible_version.client_withdrawn_at IS NULL
       ))::text AS deliverable_count,
       COUNT(DISTINCT d.id) FILTER (WHERE d.status = 'in_review' AND EXISTS (
         SELECT 1 FROM deliverable_versions visible_version
         WHERE visible_version.deliverable_id = d.id
           AND visible_version.client_submitted_at IS NOT NULL
           AND visible_version.client_withdrawn_at IS NULL
       ))::text AS pending_review_count
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

export type ClientReviewInboxFilter = "pending" | "reviewed" | "history";
export type ClientReviewInboxSort = "oldest" | "newest" | "deadline";

export async function listClientReviewInbox(
  userId: string,
  filter: ClientReviewInboxFilter,
  sort: ClientReviewInboxSort
) {
  const latestVersionClause = `version.id = (
    SELECT latest.id
    FROM deliverable_versions latest
    WHERE latest.deliverable_id = deliverable.id
      AND latest.client_submitted_at IS NOT NULL
      AND latest.client_withdrawn_at IS NULL
    ORDER BY latest.version_number DESC
    LIMIT 1
  )`;
  const hasReviewClause = `EXISTS (
    SELECT 1 FROM deliverable_reviews existing_review
    WHERE existing_review.deliverable_version_id = version.id
  )`;
  const filterClause = filter === "pending"
    ? `${latestVersionClause} AND deliverable.status = 'in_review'
       AND project.current_phase <> 'delivery' AND NOT ${hasReviewClause}`
    : filter === "reviewed"
      ? `${latestVersionClause} AND ${hasReviewClause}`
      : "TRUE";
  const orderBy = sort === "oldest"
    ? "version.client_submitted_at ASC, version.id ASC"
    : sort === "deadline"
      ? "project.deadline ASC, version.client_submitted_at ASC"
      : "version.client_submitted_at DESC, version.id DESC";

  const result = await pool.query<{
    version_id: string; deliverable_id: string; deliverable_title: string; deliverable_description: string | null;
    deliverable_status: string; version_number: number; submission_note: string | null;
    client_submitted_at: Date; file_id: string; file_name: string; file_size: string;
    mime_type: string; storage_type: string; external_url: string | null;
    project_id: string; project_name: string; project_phase: string; project_deadline: string;
    client_id: string; client_name: string; client_role: "reviewer" | "viewer";
    review_id: string | null; review_decision: "approved" | "changes_requested" | null;
    review_comment: string | null; reviewed_at: Date | null; reviewer_name: string | null;
  }>(
    `SELECT version.id AS version_id, deliverable.id AS deliverable_id,
       deliverable.title AS deliverable_title, deliverable.description AS deliverable_description,
       deliverable.status::text AS deliverable_status, version.version_number,
       version.submission_note, version.client_submitted_at,
       file.id AS file_id, file.file_name, file.file_size::text, file.mime_type,
       file.storage_type::text AS storage_type, file.external_url,
       project.id AS project_id, project.name AS project_name,
       project.current_phase::text AS project_phase, project.deadline::text AS project_deadline,
       client.id AS client_id, client.name AS client_name, membership.role AS client_role,
       review.id AS review_id, review.decision::text AS review_decision,
       review.comment AS review_comment, review.created_at AS reviewed_at,
       reviewer.name AS reviewer_name
     FROM client_memberships membership
     INNER JOIN clients client ON client.id = membership.client_id AND client.deleted_at IS NULL
     INNER JOIN projects project ON project.client_id = client.id AND project.deleted_at IS NULL
     INNER JOIN deliverables deliverable ON deliverable.project_id = project.id AND deliverable.deleted_at IS NULL
     INNER JOIN deliverable_versions version ON version.deliverable_id = deliverable.id
       AND version.client_submitted_at IS NOT NULL AND version.client_withdrawn_at IS NULL
     INNER JOIN files file ON file.id = version.file_id AND file.deleted_at IS NULL
     LEFT JOIN deliverable_reviews review ON review.id = (
       SELECT latest_review.id FROM deliverable_reviews latest_review
       WHERE latest_review.deliverable_version_id = version.id
       ORDER BY latest_review.created_at DESC, latest_review.id DESC LIMIT 1
     )
     LEFT JOIN users reviewer ON reviewer.id = review.reviewer_id
     WHERE membership.user_id = $1 AND ${filterClause}
     ORDER BY ${orderBy}
     LIMIT 100`,
    [userId]
  );

  const counts = await pool.query<{ pending: string; reviewed: string; history: string }>(
    `SELECT
       COUNT(*) FILTER (
         WHERE version.id = (
           SELECT latest.id FROM deliverable_versions latest
           WHERE latest.deliverable_id = deliverable.id
             AND latest.client_submitted_at IS NOT NULL
             AND latest.client_withdrawn_at IS NULL
           ORDER BY latest.version_number DESC LIMIT 1
         )
         AND deliverable.status = 'in_review'
         AND project.current_phase <> 'delivery'
         AND NOT EXISTS (
           SELECT 1 FROM deliverable_reviews review
           WHERE review.deliverable_version_id = version.id
         )
       )::text AS pending,
       COUNT(*) FILTER (
         WHERE version.id = (
           SELECT latest.id FROM deliverable_versions latest
           WHERE latest.deliverable_id = deliverable.id
             AND latest.client_submitted_at IS NOT NULL
             AND latest.client_withdrawn_at IS NULL
           ORDER BY latest.version_number DESC LIMIT 1
         )
         AND EXISTS (
           SELECT 1 FROM deliverable_reviews review
           WHERE review.deliverable_version_id = version.id
         )
       )::text AS reviewed,
       COUNT(*)::text AS history
     FROM client_memberships membership
     INNER JOIN clients client ON client.id = membership.client_id AND client.deleted_at IS NULL
     INNER JOIN projects project ON project.client_id = client.id AND project.deleted_at IS NULL
     INNER JOIN deliverables deliverable ON deliverable.project_id = project.id AND deliverable.deleted_at IS NULL
     INNER JOIN deliverable_versions version ON version.deliverable_id = deliverable.id
       AND version.client_submitted_at IS NOT NULL AND version.client_withdrawn_at IS NULL
     INNER JOIN files file ON file.id = version.file_id AND file.deleted_at IS NULL
     WHERE membership.user_id = $1`,
    [userId]
  );

  return {
    rows: result.rows.map((row) => ({
      versionId: row.version_id,
      deliverableId: row.deliverable_id,
      deliverableTitle: row.deliverable_title,
      deliverableDescription: row.deliverable_description,
      deliverableStatus: row.deliverable_status,
      versionNumber: row.version_number,
      submissionNote: row.submission_note,
      clientSubmittedAt: row.client_submitted_at,
      file: {
        id: row.file_id,
        name: row.file_name,
        size: row.file_size,
        mimeType: row.mime_type,
        storageType: row.storage_type,
        externalUrl: row.external_url
      },
      project: {
        id: row.project_id,
        name: row.project_name,
        phase: row.project_phase,
        deadline: row.project_deadline
      },
      client: { id: row.client_id, name: row.client_name },
      clientRole: row.client_role,
      review: row.review_id ? {
        id: row.review_id,
        decision: row.review_decision,
        comment: row.review_comment,
        reviewedAt: row.reviewed_at,
        reviewerName: row.reviewer_name
      } : null,
      canReview: filter === "pending" && row.client_role === "reviewer" && row.project_phase !== "delivery"
    })),
    counts: {
      pending: Number(counts.rows[0]?.pending ?? 0),
      reviewed: Number(counts.rows[0]?.reviewed ?? 0),
      history: Number(counts.rows[0]?.history ?? 0)
    }
  };
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
  const deliverables = await listProjectDeliverables(projectId, {
    clientVisibleOnly: true,
    includeClientFeedback: true
  });
  return {
    ...project,
    deliverables: deliverables.map((deliverable) => ({
      ...deliverable,
      status: deliverable.versions[0]?.reviews[0]?.decision ?? "in_review"
    })),
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
     WHERE dv.id = $2 AND dv.client_submitted_at IS NOT NULL AND dv.client_withdrawn_at IS NULL
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
