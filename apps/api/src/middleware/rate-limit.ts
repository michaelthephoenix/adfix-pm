import rateLimit from "express-rate-limit";
import { env } from "../config/env.js";

function skipInTest() {
  return env.NODE_ENV === "test";
}

export const authRateLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: "Too many auth requests, please try again later." }
});

export const apiRateLimiter = rateLimit({
  windowMs: env.API_RATE_LIMIT_WINDOW_MS,
  max: env.API_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: "Too many API requests, please try again later." }
});

