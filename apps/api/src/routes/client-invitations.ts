import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { requireAuth, requireStaff } from "../middleware/auth.js";
import {
  acceptClientInvitationForExistingUser,
  acceptClientInvitationForNewUser,
  createClientInvitation,
  getInvitationByToken,
  listClientAccessRecords,
  listClientInvitations,
  revokeClientInvitation
} from "../services/client-portal.service.js";
import type { AuthenticatedRequest } from "../types/http.js";
import { setRefreshCookie } from "../utils/auth-cookie.js";
import { sendConflict, sendNotFound, sendUnauthorized } from "../utils/http-error.js";
import { sendValidationError } from "../utils/validation.js";

export const clientInvitationsRouter = Router();

const createSchema = z.object({
  clientId: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(["reviewer", "viewer"]).default("reviewer")
});
const acceptSchema = z.object({
  name: z.string().trim().min(1).max(255),
  password: z.string().min(8).max(128)
});
const idSchema = z.object({ id: z.string().uuid() });
const clientIdSchema = z.object({ clientId: z.string().uuid() });
const tokenSchema = z.object({ token: z.string().min(32).max(256) });

clientInvitationsRouter.get("/", requireAuth, requireStaff, async (_req, res) => {
  return res.status(200).json({ data: await listClientAccessRecords() });
});

clientInvitationsRouter.post("/", requireAuth, requireStaff, async (req: AuthenticatedRequest, res) => {
  if (!req.user) return sendUnauthorized(res, "Unauthorized");
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, "Invalid invitation payload", parsed.error);

  const result = await createClientInvitation({ ...parsed.data, invitedBy: req.user.id });
  if (!result) return sendNotFound(res, "Client not found");

  return res.status(201).json({
    data: {
      ...result.invitation,
      inviteUrl: `${env.APP_ORIGIN}/invite/${result.token}`
    }
  });
});

clientInvitationsRouter.get("/client/:clientId", requireAuth, requireStaff, async (req, res) => {
  const parsed = clientIdSchema.safeParse(req.params);
  if (!parsed.success) return sendValidationError(res, "Invalid client id", parsed.error);
  return res.status(200).json({ data: await listClientInvitations(parsed.data.clientId) });
});

clientInvitationsRouter.delete("/:id", requireAuth, requireStaff, async (req, res) => {
  const parsed = idSchema.safeParse(req.params);
  if (!parsed.success) return sendValidationError(res, "Invalid invitation id", parsed.error);
  const revoked = await revokeClientInvitation(parsed.data.id);
  return revoked ? res.status(204).send() : sendNotFound(res, "Invitation not found");
});

clientInvitationsRouter.get("/token/:token", async (req, res) => {
  const parsed = tokenSchema.safeParse(req.params);
  if (!parsed.success) return sendValidationError(res, "Invalid invitation token", parsed.error);
  const invitation = await getInvitationByToken(parsed.data.token);
  if (!invitation) return sendNotFound(res, "Invitation not found");
  return res.status(200).json({
    data: {
      clientName: invitation.client_name,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expires_at,
      isValid: invitation.isValid,
      accountExists: false
    }
  });
});

clientInvitationsRouter.post("/token/:token/accept", async (req, res) => {
  const parsedToken = tokenSchema.safeParse(req.params);
  const parsedBody = acceptSchema.safeParse(req.body);
  if (!parsedToken.success) return sendValidationError(res, "Invalid invitation token", parsedToken.error);
  if (!parsedBody.success) return sendValidationError(res, "Invalid account payload", parsedBody.error);

  const result = await acceptClientInvitationForNewUser({
    token: parsedToken.data.token,
    ...parsedBody.data,
    userAgent: req.header("user-agent"),
    ipAddress: req.ip
  });
  if (result === "invalid") return sendNotFound(res, "Invitation is invalid or expired");
  if (result === "account_exists") return sendConflict(res, "An account already exists; sign in to accept");
  setRefreshCookie(res, result.refreshToken);
  return res.status(201).json(result);
});

clientInvitationsRouter.post(
  "/token/:token/accept-existing",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    if (!req.user) return sendUnauthorized(res, "Unauthorized");
    if (req.user.accountType !== "client") return sendConflict(res, "Invitation requires a client account");
    const parsed = tokenSchema.safeParse(req.params);
    if (!parsed.success) return sendValidationError(res, "Invalid invitation token", parsed.error);
    const accepted = await acceptClientInvitationForExistingUser({
      token: parsed.data.token,
      userId: req.user.id,
      email: req.user.email
    });
    return accepted ? res.status(200).json({ accepted: true }) : sendNotFound(res, "Invitation is invalid or expired");
  }
);
