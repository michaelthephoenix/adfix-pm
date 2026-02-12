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

export type StorageType = "local" | "s3" | "google_drive" | "dropbox" | "onedrive";

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

export async function listFilesByProjectId(projectId: string, input?: { page?: number; pageSize?: number }) {
  const page = input?.page ?? 1;
  const pageSize = input?.pageSize ?? 20;
  const offset = (page - 1) * pageSize;

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
       ORDER BY created_at DESC
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
  storageType: "google_drive" | "dropbox" | "onedrive";
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
  const result = await pool.query<{ id: string }>(
    `UPDATE files
     SET deleted_at = NOW()
     WHERE id = $1
       AND deleted_at IS NULL
     RETURNING id`,
    [fileId]
  );

  return result.rowCount === 1;
}
