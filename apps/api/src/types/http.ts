import type { Request } from "express";
import type { AuthenticatedUser } from "./auth.js";

export type AuthenticatedRequest = Request & {
  user?: AuthenticatedUser;
};
