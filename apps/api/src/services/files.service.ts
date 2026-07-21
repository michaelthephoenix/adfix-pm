import { pool } from "../db/pool.js";

export type FileType =
  | "client_profile"
  | "proposal"
  | "creative_brief"
  | "nda"
  | "contract"
  | "asset"
  | "deliverable"
  | "other";

type StorageType = "local" | "s3" | "google_drive" | "dropbox" | "onedrive" | "external";

type FileRow = {
  id: string;
  project_id: string;
  file_name: string;
  file_type: FileType;
  storage_type: StorageType;
  object_key: string;
  external_url: string | null;
  mime_type: string;
  file_size: string;
  checksum_sha256: string | null;
  uploaded_by: string;
  version: number;
  created_at: Date;
};

type FileSortBy = "createdAt" | "fileName" | "fileSize";
type SortOrder = "asc" | "desc";

const FILE_SORT_COLUMNS: Record<FileSortBy, string> = {
  createdAt: "created_at",
  fileName: "file_name",
  fileSize: "file_size"
};

export async function listFilesByProjectId(
  projectId: string,
  input?: { page?: number; pageSize?: number; sortBy?: FileSortBy; sortOrder?: SortOrder }
) {
  const page = input?.page ?? 1;
  const pageSize = input?.pageSize ?? 20;
  const offset = (page - 1) * pageSize;
  const sortBy = input?.sortBy ?? "createdAt";
  const sortOrder = input?.sortOrder ?? "desc";
  const orderColumn = FILE_SORT_COLUMNS[sortBy];
  const orderDirection = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

  const [dataResult, countResult] = await Promise.all([
    pool.query<FileRow>(
      `SELECT
         id,
         project_id,
         file_name,
         file_type,
         storage_type,
         object_key,
         external_url,
         mime_type,
         file_size::text,
         checksum_sha256,
         uploaded_by,
         version,
         created_at
       FROM files
       WHERE project_id = $1
         AND deleted_at IS NULL
       ORDER BY ${orderColumn} ${orderDirection}
       LIMIT $2 OFFSET $3`,
      [projectId, pageSize, offset]
    ),
    pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM files
       WHERE project_id = $1
         AND deleted_at IS NULL`,
      [projectId]
    )
  ]);

  return {
    rows: dataResult.rows,
    total: Number(countResult.rows[0]?.total ?? 0)
  };
}

export async function getFileById(fileId: string) {
  const result = await pool.query<FileRow>(
    `SELECT
       id,
       project_id,
       file_name,
       file_type,
       storage_type,
       object_key,
       external_url,
       mime_type,
       file_size::text,
       checksum_sha256,
       uploaded_by,
       version,
       created_at
     FROM files
     WHERE id = $1
       AND deleted_at IS NULL
     LIMIT 1`,
    [fileId]
  );

  return result.rows[0] ?? null;
}

export async function createLinkedFile(input: {
  projectId: string;
  fileName: string;
  fileType: FileType;
  storageType: "google_drive" | "dropbox" | "onedrive" | "external";
  externalUrl: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: string;
}) {
  const result = await pool.query<FileRow>(
    `INSERT INTO files (
       project_id, file_name, file_type, storage_type, object_key, external_url,
       mime_type, file_size, checksum_sha256, uploaded_by, version, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::bigint, NULL, $9, 1, NOW())
     RETURNING
       id,
       project_id,
       file_name,
       file_type,
       storage_type,
       object_key,
       external_url,
       mime_type,
       file_size::text,
       checksum_sha256,
       uploaded_by,
       version,
       created_at`,
    [
      input.projectId,
      input.fileName,
      input.fileType,
      input.storageType,
      `external/${input.storageType}/${input.fileName}`,
      input.externalUrl,
      input.mimeType,
      input.fileSize,
      input.uploadedBy
    ]
  );

  return result.rows[0];
}

export async function createUploadedFile(input: {
  projectId: string;
  fileName: string;
  fileType: FileType;
  storageType: "local" | "s3";
  objectKey: string;
  mimeType: string;
  fileSize: number;
  checksumSha256?: string | null;
  uploadedBy: string;
}) {
  const result = await pool.query<FileRow>(
    `INSERT INTO files (
       project_id, file_name, file_type, storage_type, object_key, external_url,
       mime_type, file_size, checksum_sha256, uploaded_by, version, created_at
     )
     VALUES ($1, $2, $3, $4, $5, NULL, $6, $7::bigint, $8, $9, 1, NOW())
     RETURNING
       id,
       project_id,
       file_name,
       file_type,
       storage_type,
       object_key,
       external_url,
       mime_type,
       file_size::text,
       checksum_sha256,
       uploaded_by,
       version,
       created_at`,
    [
      input.projectId,
      input.fileName,
      input.fileType,
      input.storageType,
      input.objectKey,
      input.mimeType,
      input.fileSize,
      input.checksumSha256 ?? null,
      input.uploadedBy
    ]
  );

  return result.rows[0];
}

export async function deleteFile(fileId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const state = await client.query<{ id: string; current_phase: string; referenced: boolean }>(
      `SELECT file.id, project.current_phase,
         EXISTS (
           SELECT 1 FROM deliverable_versions version WHERE version.file_id = file.id
         ) AS referenced
       FROM files file
       INNER JOIN projects project ON project.id = file.project_id AND project.deleted_at IS NULL
       WHERE file.id = $1 AND file.deleted_at IS NULL
       FOR UPDATE OF file`,
      [fileId]
    );
    const file = state.rows[0];
    if (!file) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "not_found" as const };
    }
    if (file.current_phase === "delivery") {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "delivery_locked" as const };
    }
    if (file.referenced) {
      await client.query("ROLLBACK");
      return { ok: false as const, reason: "deliverable_history" as const };
    }

    await client.query("UPDATE files SET deleted_at = NOW() WHERE id = $1", [fileId]);
    await client.query("COMMIT");
    return { ok: true as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
