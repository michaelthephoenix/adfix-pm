import { Router } from "express";
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

filesRouter.use(requireAuth);

filesRouter.get("/project/:projectId", async (req, res) => {
  const parsed = projectParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid project id" });
  }

  const files = await listFilesByProjectId(parsed.data.projectId);
  return res.status(200).json({ data: files });
});

filesRouter.post("/link", async (req: AuthenticatedRequest, res) => {
  const parsed = linkFileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid file link payload" });
  }

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
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
    return res.status(400).json({ error: "Invalid file upload payload" });
  }

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
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

filesRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const parsed = fileParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid file id" });
  }

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const existingFile = await getFileById(parsed.data.id);
  if (!existingFile) {
    return res.status(404).json({ error: "File not found" });
  }

  const deleted = await deleteFile(parsed.data.id);
  if (!deleted) {
    return res.status(404).json({ error: "File not found" });
  }

  await insertActivityLog({
    userId: req.user.id,
    projectId: existingFile.project_id,
    action: "file_deleted",
    details: { fileId: existingFile.id }
  });

  return res.status(204).send();
});

