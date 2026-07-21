import { Router } from "express";
import type { NextFunction, Response } from "express";
import crypto from "node:crypto";
import multer from "multer";
import { createReadStream } from "node:fs";
import { mkdir, open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileTypeFromFile } from "file-type";
import { z } from "zod";
import { env } from "../config/env.js";
import { requireAuth } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { insertActivityLog } from "../services/activity-log.service.js";
import {
  createLinkedFile,
  createUploadedFile,
  deleteFile,
  getFileById,
  listFilesByProjectId
} from "../services/files.service.js";
import { getProjectById } from "../services/projects.service.js";
import { hasProjectPermission } from "../services/rbac.service.js";
import { logAndSendForbidden } from "../utils/authz.js";
import { sendConflict, sendError, sendNotFound, sendUnauthorized } from "../utils/http-error.js";
import { sendValidationError } from "../utils/validation.js";
import { storageProvider } from "../storage/local-storage.js";
import { userHasClientProjectAccess } from "../services/client-portal.service.js";
import { pool } from "../db/pool.js";
import { signFilePreviewToken, verifyFilePreviewToken } from "../utils/tokens.js";

export const filesRouter = Router();

const allowedMimeTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain"
]);
const previewMimeTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "text/plain"
]);
const previewCookieName = "adfix_file_preview";
const previewSessionMs = 5 * 60 * 1000;
const incomingUploadDir = path.join(env.LOCAL_UPLOAD_DIR, ".incoming");
const prohibitedExtensions = new Set([
  ".bat", ".cmd", ".com", ".dll", ".exe", ".html", ".htm", ".jar", ".js", ".mjs", ".php", ".ps1", ".py", ".rb", ".scr", ".sh", ".svg", ".ts"
]);
const prohibitedMimeFragments = ["javascript", "ecmascript", "x-httpd-php", "x-msdownload", "x-sh", "x-shellscript"];
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      void mkdir(incomingUploadDir, { recursive: true })
        .then(() => callback(null, incomingUploadDir))
        .catch((error: unknown) => callback(error as Error, incomingUploadDir));
    },
    filename: (_req, _file, callback) => callback(null, crypto.randomUUID())
  }),
  // Busboy marks a file as truncated when it reaches its limit, so allow one
  // extra byte and enforce the inclusive product limit below.
  limits: { fileSize: env.MAX_UPLOAD_BYTES + 1, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (prohibitedMimeFragments.some((part) => file.mimetype.toLowerCase().includes(part))) {
      callback(new Error("Unsupported file type"));
      return;
    }
    callback(null, true);
  }
});

const fileTypeEnum = z.enum([
  "client_profile",
  "proposal",
  "creative_brief",
  "nda",
  "contract",
  "asset",
  "deliverable",
  "other"
]);

const linkedStorageTypeEnum = z.enum(["google_drive", "dropbox", "onedrive", "external"]);
const uploadStorageTypeEnum = z.enum(["local", "s3"]);

const projectParamsSchema = z.object({
  projectId: z.string().uuid()
});

const fileListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  sortBy: z.enum(["createdAt", "fileName", "fileSize"]).optional().default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc")
});

const fileParamsSchema = z.object({
  id: z.string().uuid()
});

const linkFileSchema = z.object({
  projectId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
  fileType: fileTypeEnum,
  storageType: linkedStorageTypeEnum,
  externalUrl: z.string().url().max(2048).refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "https:" || protocol === "http:";
  }, "File links must use HTTP or HTTPS"),
  mimeType: z.string().trim().min(1).max(127),
  fileSize: z.coerce.number().int().positive()
});

const uploadFileSchema = z.object({
  projectId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
  fileType: fileTypeEnum,
  storageType: uploadStorageTypeEnum,
  objectKey: z.string().trim().min(1).max(2048),
  mimeType: z.string().trim().min(1).max(127),
  fileSize: z.coerce.number().int().positive(),
  checksumSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional().nullable()
});

const uploadUrlRequestSchema = z.object({
  projectId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
  fileType: fileTypeEnum,
  storageType: uploadStorageTypeEnum,
  mimeType: z.string().trim().min(1).max(127),
  fileSize: z.coerce.number().int().positive()
});

const completeUploadSchema = uploadUrlRequestSchema.extend({
  objectKey: z.string().trim().min(1).max(2048),
  checksumSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional().nullable()
});

function buildObjectKey(projectId: string, fileName: string) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `projects/${projectId}/uploads/${Date.now()}-${safeName}`;
}

function buildMockSignedUploadUrl(objectKey: string, expiresAt: Date) {
  const token = crypto.randomBytes(16).toString("hex");
  return `https://uploads.adfix.local/mock-put/${encodeURIComponent(objectKey)}?token=${token}&expires=${expiresAt.toISOString()}`;
}

function buildMockSignedDownloadUrl(objectKey: string, expiresAt: Date) {
  const token = crypto.randomBytes(16).toString("hex");
  return `https://downloads.adfix.local/mock-get/${encodeURIComponent(objectKey)}?token=${token}&expires=${expiresAt.toISOString()}`;
}

function previewKind(mimeType: string) {
  if (mimeType.startsWith("image/")) return "image" as const;
  if (mimeType.startsWith("video/")) return "video" as const;
  if (mimeType.startsWith("audio/")) return "audio" as const;
  if (mimeType === "application/pdf") return "pdf" as const;
  return "text" as const;
}

async function isPlainTextFile(filePath: string) {
  const handle = await open(filePath, "r");
  try {
    const sample = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
    return !sample.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
}

async function inspectUpload(file: Express.Multer.File) {
  const extension = path.extname(file.originalname).toLowerCase();
  if (prohibitedExtensions.has(extension)) throw new Error("Unsupported file type");
  if (prohibitedMimeFragments.some((part) => file.mimetype.toLowerCase().includes(part))) {
    throw new Error("Unsupported file type");
  }

  const detected = await fileTypeFromFile(file.path);
  if (detected) {
    if (!allowedMimeTypes.has(detected.mime)) throw new Error("Unsupported file type");
    return detected.mime;
  }
  if (file.mimetype === "text/plain" && await isPlainTextFile(file.path)) return "text/plain";
  throw new Error("Unsupported file type");
}

async function canUserViewFile(input: { userId: string; accountType: "staff" | "client"; fileId: string; projectId: string }) {
  const staffAccess = await hasProjectPermission({ projectId: input.projectId, userId: input.userId, permission: "project:view" });
  if (staffAccess) return true;
  if (input.accountType !== "client") return false;
  const isSharedDeliverable = await pool.query<{ allowed: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM deliverable_versions dv
       INNER JOIN deliverables d ON d.id = dv.deliverable_id AND d.deleted_at IS NULL
       WHERE dv.file_id = $1
         AND dv.client_submitted_at IS NOT NULL
         AND dv.client_withdrawn_at IS NULL
         AND d.status IN ('in_review', 'changes_requested', 'approved')
     ) AS allowed`,
    [input.fileId]
  );
  return isSharedDeliverable.rows[0]?.allowed === true && await userHasClientProjectAccess(input.userId, input.projectId);
}

function parseByteRange(rangeHeader: string, fileSize: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : fileSize - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= fileSize) return null;
  return { start, end: Math.min(end, fileSize - 1) };
}

async function streamFilePreview(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const parsed = fileParamsSchema.safeParse(req.params);
  if (!parsed.success) return sendValidationError(res, "Invalid file id", parsed.error);
  const token = req.cookies?.[previewCookieName];
  if (typeof token !== "string") return sendUnauthorized(res, "Preview session required");

  let previewToken;
  try {
    previewToken = verifyFilePreviewToken(token);
  } catch {
    return sendUnauthorized(res, "Preview session expired");
  }
  if (previewToken.tokenType !== "file_preview" || previewToken.fileId !== parsed.data.id) {
    return sendUnauthorized(res, "Invalid preview session");
  }

  const [file, userResult] = await Promise.all([
    getFileById(parsed.data.id),
    pool.query<{ account_type: "staff" | "client" }>(
      `SELECT account_type FROM users WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL`,
      [previewToken.userId]
    )
  ]);
  const accountType = userResult.rows[0]?.account_type;
  if (!file || !accountType) return sendNotFound(res, "File not found");
  if (!previewMimeTypes.has(file.mime_type) || file.storage_type !== "local" || file.external_url) {
    return sendError(res, 415, "PREVIEW_UNAVAILABLE", "This file type must be downloaded to view");
  }
  if (!(await canUserViewFile({ userId: previewToken.userId, accountType, fileId: file.id, projectId: file.project_id }))) {
    return res.status(403).json({ code: "FORBIDDEN", error: "File preview is no longer available" });
  }

  const filePath = await storageProvider.resolve(file.object_key);
  const fileStat = await stat(filePath);
  const fileSize = fileStat.size;
  const rangeHeader = req.header("range");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Type", file.mime_type);
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);

  if (rangeHeader) {
    const range = parseByteRange(rangeHeader, fileSize);
    if (!range) {
      res.setHeader("Content-Range", `bytes */${fileSize}`);
      return res.sendStatus(416);
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${fileSize}`);
    res.setHeader("Content-Length", range.end - range.start + 1);
    if (req.method === "HEAD") return res.end();
    return createReadStream(filePath, { start: range.start, end: range.end }).on("error", next).pipe(res);
  }

  res.setHeader("Content-Length", fileSize);
  if (req.method === "HEAD") return res.end();
  return createReadStream(filePath).on("error", next).pipe(res);
}

filesRouter.get("/:id/preview", streamFilePreview);
filesRouter.head("/:id/preview", streamFilePreview);

filesRouter.use(requireAuth);

filesRouter.post("/:id/preview-session", async (req: AuthenticatedRequest, res) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  const parsed = fileParamsSchema.safeParse(req.params);
  if (!parsed.success) return sendValidationError(res, "Invalid file id", parsed.error);
  const file = await getFileById(parsed.data.id);
  if (!file) return sendNotFound(res, "File not found");
  if (!previewMimeTypes.has(file.mime_type) || file.storage_type !== "local" || file.external_url) {
    return sendError(res, 415, "PREVIEW_UNAVAILABLE", "This file type must be downloaded to view");
  }
  const allowed = await canUserViewFile({ userId: req.user.id, accountType: req.user.accountType, fileId: file.id, projectId: file.project_id });
  if (!allowed) return logAndSendForbidden({ req, res, permission: "project:view", projectId: file.project_id });

  const previewPath = `${req.baseUrl}/${file.id}/preview`;
  res.cookie(previewCookieName, signFilePreviewToken({ userId: req.user.id, fileId: file.id }), {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "strict",
    path: previewPath,
    maxAge: previewSessionMs
  });
  return res.status(200).json({
    data: {
      path: `/files/${file.id}/preview`,
      fileName: file.file_name,
      mimeType: file.mime_type,
      kind: previewKind(file.mime_type),
      expiresInSeconds: previewSessionMs / 1000
    }
  });
});

filesRouter.post("/upload-binary", upload.single("file"), async (req: AuthenticatedRequest, res) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  if (req.user.accountType !== "staff") return res.status(403).json({ code: "FORBIDDEN", error: "Staff access required" });
  try {
    const parsed = z.object({ projectId: z.string().uuid(), fileType: fileTypeEnum }).safeParse(req.body);
    if (!parsed.success) return sendValidationError(res, "Invalid upload metadata", parsed.error);
    if (!req.file) return sendError(res, 400, "VALIDATION_ERROR", "A file is required");
    if (req.file.size > env.MAX_UPLOAD_BYTES) {
      return sendError(res, 413, "FILE_TOO_LARGE", "Files must be 50 MB or smaller");
    }

    const project = await getProjectById(parsed.data.projectId);
    if (!project) return sendNotFound(res, "Project not found");
    const allowed = await hasProjectPermission({ projectId: project.id, userId: req.user.id, permission: "file:write" });
    if (!allowed) return logAndSendForbidden({ req, res, permission: "file:write", projectId: project.id });

    const mimeType = await inspectUpload(req.file);
    const stored = await storageProvider.saveFromPath({ sourcePath: req.file.path, fileName: req.file.originalname });
    try {
      const file = await createUploadedFile({
        projectId: project.id,
        fileName: req.file.originalname,
        fileType: parsed.data.fileType,
        storageType: "local",
        objectKey: stored.objectKey,
        mimeType,
        fileSize: stored.size,
        checksumSha256: stored.checksumSha256,
        uploadedBy: req.user.id
      });
      await insertActivityLog({ userId: req.user.id, projectId: project.id, action: "file_uploaded", details: { fileId: file.id } });
      return res.status(201).json({ data: file });
    } catch (error) {
      await storageProvider.delete(stored.objectKey);
      throw error;
    }
  } finally {
    if (req.file?.path) await rm(req.file.path, { force: true });
  }
});

filesRouter.get("/:id/content", async (req: AuthenticatedRequest, res, next: NextFunction) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  const parsed = fileParamsSchema.safeParse(req.params);
  if (!parsed.success) return sendValidationError(res, "Invalid file id", parsed.error);
  const file = await getFileById(parsed.data.id);
  if (!file) return sendNotFound(res, "File not found");

  const allowed = await canUserViewFile({ userId: req.user.id, accountType: req.user.accountType, fileId: file.id, projectId: file.project_id });
  if (!allowed) return logAndSendForbidden({ req, res, permission: "project:view", projectId: file.project_id });
  if (file.external_url) return res.redirect(file.external_url);
  if (file.storage_type !== "local") return sendNotFound(res, "File content is unavailable locally");

  const filePath = await storageProvider.resolve(file.object_key);
  const fileStat = await stat(filePath);
  res.setHeader("Content-Type", file.mime_type);
  res.setHeader("Content-Length", fileStat.size);
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
  return createReadStream(filePath).on("error", next).pipe(res);
});

filesRouter.get("/project/:projectId", async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const parsedParams = projectParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid project id", parsedParams.error);
  }

  const parsedQuery = fileListQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return sendValidationError(res, "Invalid files query", parsedQuery.error);
  }

  const project = await getProjectById(parsedParams.data.projectId);
  if (!project) {
    return sendNotFound(res, "Project not found");
  }

  const canViewProject = await hasProjectPermission({
    projectId: parsedParams.data.projectId,
    userId: req.user.id,
    permission: "project:view"
  });
  if (!canViewProject) {
    return logAndSendForbidden({
      req,
      res,
      permission: "project:view",
      projectId: parsedParams.data.projectId
    });
  }

  const result = await listFilesByProjectId(parsedParams.data.projectId, parsedQuery.data);
  return res.status(200).json({
    data: result.rows,
    meta: {
      page: parsedQuery.data.page,
      pageSize: parsedQuery.data.pageSize,
      sortBy: parsedQuery.data.sortBy,
      sortOrder: parsedQuery.data.sortOrder,
      total: result.total
    }
  });
});

filesRouter.post("/link", async (req: AuthenticatedRequest, res) => {
  const parsed = linkFileSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid file link payload", parsed.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const project = await getProjectById(parsed.data.projectId);
  if (!project) {
    return sendNotFound(res, "Project not found");
  }

  const canWriteFile = await hasProjectPermission({
    projectId: parsed.data.projectId,
    userId: req.user.id,
    permission: "file:write"
  });
  if (!canWriteFile) {
    return logAndSendForbidden({
      req,
      res,
      permission: "file:write",
      projectId: parsed.data.projectId
    });
  }

  const file = await createLinkedFile({
    ...parsed.data,
    uploadedBy: req.user.id
  });

  await insertActivityLog({
    userId: req.user.id,
    projectId: file.project_id,
    action: "file_linked",
    details: { fileId: file.id, storageType: file.storage_type }
  });

  return res.status(201).json({ data: file });
});

filesRouter.post("/upload", async (req: AuthenticatedRequest, res) => {
  const parsed = uploadFileSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid file upload payload", parsed.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const project = await getProjectById(parsed.data.projectId);
  if (!project) {
    return sendNotFound(res, "Project not found");
  }

  const canWriteFile = await hasProjectPermission({
    projectId: parsed.data.projectId,
    userId: req.user.id,
    permission: "file:write"
  });
  if (!canWriteFile) {
    return logAndSendForbidden({
      req,
      res,
      permission: "file:write",
      projectId: parsed.data.projectId
    });
  }

  const file = await createUploadedFile({
    ...parsed.data,
    uploadedBy: req.user.id
  });

  await insertActivityLog({
    userId: req.user.id,
    projectId: file.project_id,
    action: "file_uploaded",
    details: { fileId: file.id, objectKey: file.object_key, storageType: file.storage_type }
  });

  return res.status(201).json({ data: file });
});

filesRouter.post("/upload-url", async (req: AuthenticatedRequest, res) => {
  const parsed = uploadUrlRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid upload-url payload", parsed.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const project = await getProjectById(parsed.data.projectId);
  if (!project) {
    return sendNotFound(res, "Project not found");
  }

  const canWriteFile = await hasProjectPermission({
    projectId: parsed.data.projectId,
    userId: req.user.id,
    permission: "file:write"
  });
  if (!canWriteFile) {
    return logAndSendForbidden({
      req,
      res,
      permission: "file:write",
      projectId: parsed.data.projectId
    });
  }

  const objectKey = buildObjectKey(parsed.data.projectId, parsed.data.fileName);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const uploadUrl = buildMockSignedUploadUrl(objectKey, expiresAt);

  return res.status(200).json({
    data: {
      projectId: parsed.data.projectId,
      fileName: parsed.data.fileName,
      fileType: parsed.data.fileType,
      storageType: parsed.data.storageType,
      mimeType: parsed.data.mimeType,
      fileSize: parsed.data.fileSize,
      objectKey,
      uploadUrl,
      expiresAt: expiresAt.toISOString()
    }
  });
});

filesRouter.post("/complete-upload", async (req: AuthenticatedRequest, res) => {
  const parsed = completeUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid complete-upload payload", parsed.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const project = await getProjectById(parsed.data.projectId);
  if (!project) {
    return sendNotFound(res, "Project not found");
  }

  const canWriteFile = await hasProjectPermission({
    projectId: parsed.data.projectId,
    userId: req.user.id,
    permission: "file:write"
  });
  if (!canWriteFile) {
    return logAndSendForbidden({
      req,
      res,
      permission: "file:write",
      projectId: parsed.data.projectId
    });
  }

  const file = await createUploadedFile({
    ...parsed.data,
    uploadedBy: req.user.id
  });

  await insertActivityLog({
    userId: req.user.id,
    projectId: file.project_id,
    action: "file_uploaded",
    details: { fileId: file.id, objectKey: file.object_key, storageType: file.storage_type }
  });

  return res.status(201).json({ data: file });
});

filesRouter.get("/:id/download-url", async (req: AuthenticatedRequest, res) => {
  const parsed = fileParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid file id", parsed.error);
  }

  const file = await getFileById(parsed.data.id);
  if (!file) {
    return sendNotFound(res, "File not found");
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const canViewFile = await hasProjectPermission({
    projectId: file.project_id,
    userId: req.user.id,
    permission: "project:view"
  });
  if (!canViewFile) {
    return logAndSendForbidden({
      req,
      res,
      permission: "project:view",
      projectId: file.project_id
    });
  }

  // External linked files are returned directly.
  if (file.external_url) {
    return res.status(200).json({
      data: {
        fileId: file.id,
        downloadUrl: file.external_url,
        expiresAt: null
      }
    });
  }

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const downloadUrl = buildMockSignedDownloadUrl(file.object_key, expiresAt);

  return res.status(200).json({
    data: {
      fileId: file.id,
      downloadUrl,
      expiresAt: expiresAt.toISOString()
    }
  });
});

filesRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const parsed = fileParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid file id", parsed.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const existingFile = await getFileById(parsed.data.id);
  if (!existingFile) {
    return sendNotFound(res, "File not found");
  }

  const canWriteFile = await hasProjectPermission({
    projectId: existingFile.project_id,
    userId: req.user.id,
    permission: "file:write"
  });
  if (!canWriteFile) {
    return logAndSendForbidden({
      req,
      res,
      permission: "file:write",
      projectId: existingFile.project_id
    });
  }

  const deleted = await deleteFile(parsed.data.id);
  if (!deleted.ok) {
    if (deleted.reason === "delivery_locked") {
      return sendConflict(res, "Files are immutable after the project enters Delivery");
    }
    if (deleted.reason === "deliverable_history") {
      return sendConflict(res, "Files used by a deliverable version are retained as immutable review history");
    }
    return sendNotFound(res, "File not found");
  }

  if (existingFile.storage_type === "local") {
    await storageProvider.delete(existingFile.object_key);
  }

  await insertActivityLog({
    userId: req.user.id,
    projectId: existingFile.project_id,
    action: "file_deleted",
    details: { fileId: existingFile.id }
  });

  return res.status(204).send();
});
