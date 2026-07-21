import bcrypt from "bcryptjs";
import path from "node:path";
import { mkdir, open, readdir, rm, writeFile } from "node:fs/promises";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { env } from "../../src/config/env.js";
import { runMigrations } from "../../src/db/migrations.js";
import { closeDatabase, pool } from "../../src/db/pool.js";

const app = createApp();
const password = "ChangeMe123!";
const boundaryDir = path.join(env.LOCAL_UPLOAD_DIR, ".security-fixtures");
const exactLimitFile = path.join(boundaryDir, "exact-limit.png");
const overLimitFile = path.join(boundaryDir, "over-limit.png");
const validPngPrefix = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

async function createSparsePng(target: string, size: number) {
  const handle = await open(target, "w");
  try {
    await handle.write(validPngPrefix, 0, validPngPrefix.length, 0);
    await handle.truncate(size);
  } finally {
    await handle.close();
  }
}

async function loginAndCreateProject() {
  const login = await request(app).post("/api/v1/auth/login").send({ email: "admin@adfix.local", password });
  const accessToken = login.body.accessToken as string;
  const client = await request(app).post("/api/v1/clients")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ name: "Upload Security Client" });
  const project = await request(app).post("/api/v1/projects")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      clientId: client.body.data.id,
      name: "Upload Security Project",
      startDate: "2026-07-21",
      deadline: "2026-08-21"
    });
  return { accessToken, projectId: project.body.data.id as string };
}

beforeAll(async () => {
  await runMigrations();
  await mkdir(boundaryDir, { recursive: true });
  await Promise.all([
    createSparsePng(exactLimitFile, env.MAX_UPLOAD_BYTES),
    createSparsePng(overLimitFile, env.MAX_UPLOAD_BYTES + 1)
  ]);
});

beforeEach(async () => {
  await pool.query(
    "TRUNCATE TABLE workflow_mutation_keys, notification_outbox, notifications, activity_log, project_team, task_comments, files, tasks, projects, auth_sessions, clients, users RESTART IDENTITY CASCADE"
  );
  const passwordHash = await bcrypt.hash(password, 4);
  await pool.query(
    "INSERT INTO users (email, name, password_hash, is_active, is_admin, account_type) VALUES ('admin@adfix.local', 'Adfix Admin', $1, TRUE, TRUE, 'staff')",
    [passwordHash]
  );
});

afterAll(async () => {
  await closeDatabase();
  await rm(boundaryDir, { recursive: true, force: true });
});

describe("file upload security", () => {
  it("accepts the exact 50 MB boundary and rejects one byte over", async () => {
    const { accessToken, projectId } = await loginAndCreateProject();
    const accepted = await request(app).post("/api/v1/files/upload-binary")
      .set("Authorization", `Bearer ${accessToken}`)
      .field("projectId", projectId)
      .field("fileType", "asset")
      .attach("file", exactLimitFile, { contentType: "image/png" });
    expect(accepted.status).toBe(201);
    expect(Number(accepted.body.data.file_size)).toBe(env.MAX_UPLOAD_BYTES);

    const rejected = await request(app).post("/api/v1/files/upload-binary")
      .set("Authorization", `Bearer ${accessToken}`)
      .field("projectId", projectId)
      .field("fileType", "asset")
      .attach("file", overLimitFile, { contentType: "image/png" });
    expect(rejected.status).toBe(413);
    expect(rejected.body).toEqual(expect.objectContaining({ code: "FILE_TOO_LARGE" }));
  }, 120_000);

  it("rejects executable signatures and script extensions even when the browser MIME looks safe", async () => {
    const { accessToken, projectId } = await loginAndCreateProject();
    const executable = await request(app).post("/api/v1/files/upload-binary")
      .set("Authorization", `Bearer ${accessToken}`)
      .field("projectId", projectId)
      .field("fileType", "asset")
      .attach("file", Buffer.from("MZ\u0000\u0000unsafe"), { filename: "poster.png", contentType: "image/png" });
    expect(executable.status).toBe(415);

    const script = await request(app).post("/api/v1/files/upload-binary")
      .set("Authorization", `Bearer ${accessToken}`)
      .field("projectId", projectId)
      .field("fileType", "asset")
      .attach("file", Buffer.from("console.log('unsafe')"), { filename: "notes.js", contentType: "text/plain" });
    expect(script.status).toBe(415);
  });

  it("removes rejected temporary objects and gives concurrent uploads unique stored keys", async () => {
    const { accessToken, projectId } = await loginAndCreateProject();
    const uploadText = (name: string) => request(app).post("/api/v1/files/upload-binary")
      .set("Authorization", `Bearer ${accessToken}`)
      .field("projectId", projectId)
      .field("fileType", "asset")
      .attach("file", Buffer.from(`safe content for ${name}`), { filename: name, contentType: "text/plain" });

    const [first, second] = await Promise.all([uploadText("first.txt"), uploadText("second.txt")]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.object_key).not.toBe(second.body.data.object_key);

    await request(app).post("/api/v1/files/upload-binary")
      .set("Authorization", `Bearer ${accessToken}`)
      .field("projectId", projectId)
      .field("fileType", "asset")
      .attach("file", Buffer.from("#!/bin/sh"), { filename: "attack.sh", contentType: "text/plain" });
    const incoming = path.join(env.LOCAL_UPLOAD_DIR, ".incoming");
    expect(await readdir(incoming)).toEqual([]);
  });
});
