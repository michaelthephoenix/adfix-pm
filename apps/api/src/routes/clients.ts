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

clientsRouter.use(requireAuth);

clientsRouter.get("/", async (_req, res) => {
  const clients = await listClients();
  return res.status(200).json({ data: clients });
});

clientsRouter.get("/:id", async (req, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({ error: "Invalid client id" });
  }

  const client = await getClientById(parsedParams.data.id);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
  }

  return res.status(200).json({ data: client });
});

clientsRouter.post("/", async (req: AuthenticatedRequest, res) => {
  const parsed = clientCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid client payload" });
  }

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
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
    return res.status(400).json({ error: "Invalid client id" });
  }

  const parsed = clientUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid client payload" });
  }

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const client = await updateClient(parsedParams.data.id, parsed.data);
  if (!client) {
    return res.status(404).json({ error: "Client not found" });
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
    return res.status(400).json({ error: "Invalid client id" });
  }

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const deleted = await deleteClient(parsedParams.data.id);
  if (!deleted) {
    return res.status(404).json({ error: "Client not found" });
  }

  await insertActivityLog({
    userId: req.user.id,
    action: "client_deleted",
    details: { clientId: parsedParams.data.id },
    projectId: null
  });

  return res.status(204).send();
});
