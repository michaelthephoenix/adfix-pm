import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../../src/middleware/errors.js";

const originalNodeEnv = process.env.NODE_ENV;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  consoleError.mockRestore();
});

describe("Express async error handling", () => {
  it("forwards rejected async handlers to the API error response", async () => {
    const app = express();
    app.get("/boom", async () => {
      throw new Error("database connection failed");
    });
    app.use(errorHandler);

    const response = await request(app).get("/boom");

    expect(response.status).toBe(500);
    expect(response.body.code).toBe("INTERNAL_ERROR");
    expect(response.body.error).toBe("database connection failed");
    expect(consoleError).toHaveBeenCalled();
  });

  it("does not expose internal exception details in production", async () => {
    process.env.NODE_ENV = "production";
    const app = express();
    app.get("/boom", async () => {
      throw new Error("sensitive database details");
    });
    app.use(errorHandler);

    const response = await request(app).get("/boom");

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Internal server error");
    expect(JSON.stringify(response.body)).not.toContain("sensitive database details");
  });
});
