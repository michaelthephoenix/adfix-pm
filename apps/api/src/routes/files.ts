import { Router } from "express";
import crypto from "node:crypto";
import { z } from "zod";
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
import { sendNotFound, sendUnauthorized } from "../utils/http-error.js";
import { sendValidationError } from "../utils/validation.js";

export const filesRouter = Router();

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

const linkedStorageTypeEnum = z.enum(["google_drive", "dropbox", "onedrive"]);
const uploadStorageTypeEnum = z.enum(["local", "s3"]);

const projectParamsSchema = z.object({
  projectId: z.string().uuid()
});

const fileListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20)
});

const fileParamsSchema = z.object({
  id: z.string().uuid()
});

const linkFileSchema = z.object({
  projectId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
  fileType: fileTypeEnum,
  storageType: linkedStorageTypeEnum,
  externalUrl: z.string().url().max(2048),
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

filesRouter.use(requireAuth);

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
  if (!deleted) {
    return sendNotFound(res, "File not found");
  }

  await insertActivityLog({
    userId: req.user.id,
    projectId: existingFile.project_id,
    action: "file_deleted",
    details: { fileId: existingFile.id }
  });

  return res.status(204).send();
});
