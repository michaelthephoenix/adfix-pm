import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { runSearch } from "../services/search.service.js";
import { sendUnauthorized } from "../utils/http-error.js";
import { sendValidationError } from "../utils/validation.js";

export const searchRouter = Router();

const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
  scope: z.enum(["all", "projects", "tasks", "files", "clients"]).default("all"),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

searchRouter.use(requireAuth);

searchRouter.get("/", async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return sendUnauthorized(res, "Unauthorized");
  }

  const parsed = searchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return sendValidationError(res, "Invalid search query", parsed.error);
  }

  const data = await runSearch({
    query: parsed.data.q,
    scope: parsed.data.scope,
    limit: parsed.data.limit,
    userId: req.user.id
  });

  return res.status(200).json({ data });
});
