import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

function productionEnv(overrides: Record<string, string | undefined> = {}) {
  Object.assign(process.env, {
    NODE_ENV: "production",
    APP_ORIGIN: "https://pm.example.com",
    COOKIE_SECURE: "true",
    CORS_ALLOWED_ORIGINS: "https://pm.example.com",
    JWT_ACCESS_SECRET: "a-unique-production-access-secret-1234567890",
    JWT_REFRESH_SECRET: "a-different-production-refresh-secret-12345",
    SEED_PROFILE: "admin_only",
    SEED_ADMIN_PASSWORD: "UniqueBootstrapPassword123!",
    ...overrides
  });
}

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  vi.resetModules();
});

describe("production environment security", () => {
  it("accepts HTTPS with secure cookies and explicit secrets", async () => {
    productionEnv();
    vi.resetModules();

    const { env } = await import("../../src/config/env.js");

    expect(env.NODE_ENV).toBe("production");
    expect(env.COOKIE_SECURE).toBe(true);
  });

  it("rejects insecure production cookies and the demo profile", async () => {
    productionEnv({ COOKIE_SECURE: "false", SEED_PROFILE: "demo" });
    vi.resetModules();

    await expect(import("../../src/config/env.js")).rejects.toMatchObject({ name: "ZodError" });
  });

  it("rejects HTTP origins and a shared signing secret", async () => {
    productionEnv({
      APP_ORIGIN: "http://pm.example.com",
      JWT_REFRESH_SECRET: "a-unique-production-access-secret-1234567890"
    });
    vi.resetModules();

    await expect(import("../../src/config/env.js")).rejects.toMatchObject({ name: "ZodError" });
  });
});
