import { pool } from "../db/pool.js";

export type DeliverableStatus = "draft" | "in_review" | "changes_requested" | "approved";
export type ReviewDecision = "approved" | "changes_requested";

type DeliverableRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: DeliverableStatus;
  created_by: string;
  created_at: Date;
  updated_at: Date;
};

type VersionRow = {
  id: string;
  deliverable_id: string;
  file_id: string;
  version_number: number;
  submission_note: string | null;
  submitted_by: string;
  submitted_at: Date;
  file_name: string;
  mime_type: string;
  file_size: string;
};

type ReviewRow = {
  id: string;
  deliverable_version_id: string;
  reviewer_id: string;
  reviewer_name: string;
  decision: ReviewDecision;
  comment: string | null;
  created_at: Date;
};

export async function createDeliverable(input: {
  projectId: string;
  title: string;
  description?: string | null;
  userId: string;
}) {
  const result = await pool.query<DeliverableRow>(
    `INSERT INTO deliverables (project_id, title, description, status, created_by)
     VALUES ($1, $2, $3, 'draft', $4)
     RETURNING id, project_id, title, description, status, created_by, created_at, updated_at`,
    [input.projectId, input.title, input.description ?? null, input.userId]
  );
  return result.rows[0];
}

export async function getDeliverableProjectId(deliverableId: string) {
  const result = await pool.query<{ project_id: string }>(
    "SELECT project_id FROM deliverables WHERE id = $1 AND deleted_at IS NULL",
    [deliverableId]
  );
  return result.rows[0]?.project_id ?? null;
}

export async function listProjectDeliverables(projectId: string) {
  const [deliverablesResult, versionsResult, reviewsResult] = await Promise.all([
    pool.query<DeliverableRow>(
      `SELECT id, project_id, title, description, status, created_by, created_at, updated_at
       FROM deliverables
       WHERE project_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [projectId]
    ),
    pool.query<VersionRow>(
      `SELECT
         dv.id, dv.deliverable_id, dv.file_id, dv.version_number, dv.submission_note,
         dv.submitted_by, dv.submitted_at, f.file_name, f.mime_type, f.file_size::text
       FROM deliverable_versions dv
       INNER JOIN deliverables d ON d.id = dv.deliverable_id AND d.deleted_at IS NULL
       INNER JOIN files f ON f.id = dv.file_id AND f.deleted_at IS NULL
       WHERE d.project_id = $1
       ORDER BY dv.version_number DESC`,
      [projectId]
    ),
    pool.query<ReviewRow>(
      `SELECT
         dr.id, dr.deliverable_version_id, dr.reviewer_id, u.name AS reviewer_name,
         dr.decision, dr.comment, dr.created_at
       FROM deliverable_reviews dr
       INNER JOIN deliverable_versions dv ON dv.id = dr.deliverable_version_id
       INNER JOIN deliverables d ON d.id = dv.deliverable_id AND d.deleted_at IS NULL
       INNER JOIN users u ON u.id = dr.reviewer_id
       WHERE d.project_id = $1
       ORDER BY dr.created_at DESC`,
      [projectId]
    )
  ]);

  const reviewsByVersion = new Map<string, ReviewRow[]>();
  for (const review of reviewsResult.rows) {
    reviewsByVersion.set(review.deliverable_version_id, [
      ...(reviewsByVersion.get(review.deliverable_version_id) ?? []),
      review
    ]);
  }

  const versionsByDeliverable = new Map<string, Array<VersionRow & { reviews: ReviewRow[] }>>();
  for (const version of versionsResult.rows) {
    versionsByDeliverable.set(version.deliverable_id, [
      ...(versionsByDeliverable.get(version.deliverable_id) ?? []),
      { ...version, reviews: reviewsByVersion.get(version.id) ?? [] }
    ]);
  }

  return deliverablesResult.rows.map((deliverable) => ({
    ...deliverable,
    versions: versionsByDeliverable.get(deliverable.id) ?? []
  }));
}

export async function addDeliverableVersion(input: {
  deliverableId: string;
  fileId: string;
  submissionNote?: string | null;
  userId: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const deliverableResult = await client.query<DeliverableRow>(
      `SELECT id, project_id, title, description, status, created_by, created_at, updated_at
       FROM deliverables WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [input.deliverableId]
    );
    const deliverable = deliverableResult.rows[0];
    if (!deliverable) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "deliverable_not_found" as const };
    }

    const fileResult = await client.query<{ id: string }>(
      `SELECT id FROM files WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
      [input.fileId, deliverable.project_id]
    );
    if (!fileResult.rows[0]) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "file_not_found" as const };
    }

    const versionResult = await client.query<VersionRow>(
      `INSERT INTO deliverable_versions (
         deliverable_id, file_id, version_number, submission_note, submitted_by
       )
       SELECT $1, $2, COALESCE(MAX(version_number), 0) + 1, $3, $4
       FROM deliverable_versions WHERE deliverable_id = $1
       RETURNING id, deliverable_id, file_id, version_number, submission_note,
         submitted_by, submitted_at, ''::text AS file_name, ''::text AS mime_type, '0'::text AS file_size`,
      [input.deliverableId, input.fileId, input.submissionNote ?? null, input.userId]
    );

    await client.query(
      `UPDATE deliverables SET status = 'in_review', updated_at = NOW() WHERE id = $1`,
      [input.deliverableId]
    );
    await client.query("COMMIT");
    return { ok: true as const, deliverable, version: versionResult.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function reviewDeliverableVersion(input: {
  versionId: string;
  reviewerId: string;
  decision: ReviewDecision;
  comment?: string | null;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const accessResult = await client.query<{
      deliverable_id: string;
      project_id: string;
      project_name: string;
      title: string;
      current_phase: string;
      client_id: string;
      latest_version_id: string;
    }>(
      `SELECT
         d.id AS deliverable_id, d.project_id, p.name AS project_name, d.title,
         p.current_phase, p.client_id,
         (SELECT id FROM deliverable_versions WHERE deliverable_id = d.id ORDER BY version_number DESC LIMIT 1) AS latest_version_id
       FROM deliverable_versions dv
       INNER JOIN deliverables d ON d.id = dv.deliverable_id AND d.deleted_at IS NULL
       INNER JOIN projects p ON p.id = d.project_id AND p.deleted_at IS NULL
       INNER JOIN client_memberships cm ON cm.client_id = p.client_id AND cm.user_id = $2
       WHERE dv.id = $1
       FOR UPDATE OF d`,
      [input.versionId, input.reviewerId]
    );
    const access = accessResult.rows[0];
    if (!access) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "not_found" as const };
    }
    if (access.current_phase === "delivery") {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "delivery_locked" as const };
    }
    if (access.latest_version_id !== input.versionId) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "not_latest" as const };
    }

    const reviewResult = await client.query<ReviewRow>(
      `INSERT INTO deliverable_reviews (deliverable_version_id, reviewer_id, decision, comment)
       VALUES ($1, $2, $3, $4)
       RETURNING id, deliverable_version_id, reviewer_id, ''::text AS reviewer_name, decision, comment, created_at`,
      [input.versionId, input.reviewerId, input.decision, input.comment ?? null]
    );
    await client.query(
      `UPDATE deliverables SET status = $1, updated_at = NOW() WHERE id = $2`,
      [input.decision, access.deliverable_id]
    );
    await client.query("COMMIT");
    return { ok: true as const, review: reviewResult.rows[0], access };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function countUnresolvedDeliverables(projectId: string) {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM deliverables
     WHERE project_id = $1 AND deleted_at IS NULL AND status <> 'approved'`,
    [projectId]
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function listClientReviewerIds(clientId: string) {
  const result = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM client_memberships WHERE client_id = $1 AND role = 'reviewer'`,
    [clientId]
  );
  return result.rows.map((row) => row.user_id);
}
