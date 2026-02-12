import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { getUserById, listUsers, updateUserProfile } from "../services/users.service.js";

export const usersRouter = Router();

const idParamsSchema = z.object({
  id: z.string().uuid()
});

const userUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    avatarUrl: z.string().trim().url().max(2048).optional().nullable()
  })
  .refine((value) => typeof value.name !== "undefined" || typeof value.avatarUrl !== "undefined", {
    message: "At least one field is required"
  });

usersRouter.use(requireAuth);

usersRouter.get("/", async (_req, res) => {
  const users = await listUsers();
  return res.status(200).json({ data: users });
});

usersRouter.get("/:id", async (req, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({ error: "Invalid user id" });
  }

  const user = await getUserById(parsedParams.data.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  return res.status(200).json({ data: user });
});

usersRouter.put("/:id", async (req: AuthenticatedRequest, res) => {
  const parsedParams = idParamsSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({ error: "Invalid user id" });
  }

  const parsedBody = userUpdateSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: "Invalid user payload" });
  }

  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.user.id !== parsedParams.data.id) {
    return res.status(403).json({ error: "You can only update your own profile" });
  }

  const user = await updateUserProfile(parsedParams.data.id, parsedBody.data);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  return res.status(200).json({ data: user });
});

