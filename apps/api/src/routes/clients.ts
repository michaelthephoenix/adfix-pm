import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { insertActivityLog } from "../services/activity-log.service.js";
import {
  createClient,
  deleteClient,
  getClientById,
  listClients,
  updateClient
} from "../services/clients.service.js";
import { sendNotFound, sendUnauthorized } from "../utils/http-error.js";
import { sendValidationError } from "../utils/validation.js";

export const clientsRouter = Router();

const clientCreateSchema = z.object({
  name: z.string().trim().min(1).max(255),
  company: z.string().trim().max(255).optional().nullable(),
  email: z.string().email().max(255).optional().nullable(),
  phone: z.string().trim().max(50).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable()
});

const clientUpdateSchema = clientCreateSchema.partial();

const idParamsSchema = z.object({
  id: z.string().uuid()
});

const clientsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  sortBy: z.enum(["createdAt", "updatedAt", "name"]).optional().default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc")
});

clientsRouter.use(requireAuth);

clientsRouter.get("/", async (req, res) => {
  const parsedQuery = clientsListQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return sendValidationError(res, "Invalid clients query", parsedQuery.error);
  }

  const result = await listClients(parsedQuery.data);
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

clientsRouter.get("/:id", async (req, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid client id", parsedParams.error);
  }

  const client = await getClientById(parsedParams.data.id);
  if (!client) {
    return sendNotFound(res, "Client not found");
  }

  return res.status(200).json({ data: client });
});

clientsRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const parsed = clientCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid client payload", parsed.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const client = await createClient(parsed.data);
  await insertActivityLog({
    userId: req.user.id,
    action: "client_created",
    details: { clientId: client.id, name: client.name },
    projectId: null
  });

  return res.status(201).json({ data: client });
});

clientsRouter.put("/:id", async (req: AuthenticatedRequest, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid client id", parsedParams.error);
  }

  const parsed = clientUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid client payload", parsed.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const client = await updateClient(parsedParams.data.id, parsed.data);
  if (!client) {
    return sendNotFound(res, "Client not found");
  }

  await insertActivityLog({
    userId: req.user.id,
    action: "client_updated",
    details: { clientId: client.id, updatedFields: Object.keys(parsed.data) },
    projectId: null
  });

  return res.status(200).json({ data: client });
});

clientsRouter.delete("/:id", async (req: AuthenticatedRequest, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return sendValidationError(res, "Invalid client id", parsedParams.error);
  }

  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const deleted = await deleteClient(parsedParams.data.id);
  if (!deleted) {
    return sendNotFound(res, "Client not found");
  }

  await insertActivityLog({
    userId: req.user.id,
    action: "client_deleted",
    details: { clientId: parsedParams.data.id },
    projectId: null
  });

  return res.status(204).send();
});
