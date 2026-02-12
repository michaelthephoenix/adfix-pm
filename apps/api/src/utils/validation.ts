import type { Response } from "express";
import type { ZodError } from "zod";
import { sendError } from "./http-error.js";

export function sendValidationError(res: Response, message: string, error: ZodError) {
  return sendError(res, 400, "VALIDATION_ERROR", message, error.flatten());
}
