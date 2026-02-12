import type { Response } from "express";
import type { ZodError } from "zod";

export function sendValidationError(res: Response, message: string, error: ZodError) {
  return res.status(400).json({
    error: message,
    details: error.flatten()
  });
}
