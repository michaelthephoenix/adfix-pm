import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";

type LoginResult = {
  accessToken: string;
  refreshToken: string;
};

const app = createApp();

const adminUser = {
  email: "admin@adfix.local",
  name: "Adfix Admin",
  password: "ChangeMe123!"
};

async function resetDatabase() {
  await pool.query(
    `TRUNCATE TABLE activity_log, project_team, files, tasks, projects, auth_sessions, clients, users RESTART IDENTITY CASCADE`
  );

  const passwordHash = await bcrypt.hash(adminUser.password, 12);

  await pool.query(
    `INSERT INTO users (email, name, password_hash, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, TRUE, NOW(), NOW())`,
    [adminUser.email, adminUser.name, passwordHash]
  );
}

async function login(): Promise<LoginResult> {
  const response = await request(app).post("/api/auth/login").send({
    email: adminUser.email,
    password: adminUser.password
  });

  expect(response.status).toBe(200);
  expect(response.body.accessToken).toBeTypeOf("string");
  expect(response.body.refreshToken).toBeTypeOf("string");

  return {
    accessToken: response.body.accessToken,
    refreshToken: response.body.refreshToken
  };
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await pool.end();
});

describe("API integration", () => {
  it("auth: login, me, refresh, logout, logout-all", async () => {
    const firstLogin = await login();

    const meResponse = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${firstLogin.accessToken}`);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.user.email).toBe(adminUser.email);

    const refreshResponse = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: firstLogin.refreshToken });

    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body.refreshToken).not.toBe(firstLogin.refreshToken);

    const logoutResponse = await request(app)
      .post("/api/auth/logout")
      .send({ refreshToken: refreshResponse.body.refreshToken });

    expect(logoutResponse.status).toBe(204);

    const revokedRefresh = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: refreshResponse.body.refreshToken });

    expect(revokedRefresh.status).toBe(401);

    const sessionA = await login();
    const sessionB = await login();

    const logoutAll = await request(app)
      .post("/api/auth/logout-all")
      .send({ refreshToken: sessionA.refreshToken });

    expect(logoutAll.status).toBe(204);

    const refreshA = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: sessionA.refreshToken });

    const refreshB = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: sessionB.refreshToken });

    expect(refreshA.status).toBe(401);
    expect(refreshB.status).toBe(401);
  });

  it("clients: CRUD with activity logs", async () => {
    const auth = await login();

    const createResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ name: "Acme", company: "Acme Co" });

    expect(createResponse.status).toBe(201);
    const clientId = createResponse.body.data.id as string;

    const listResponse = await request(app)
      .get("/api/clients")
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body.data)).toBe(true);
    expect(listResponse.body.data.length).toBe(1);

    const updateResponse = await request(app)
      .put(`/api/clients/${clientId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ notes: "priority client" });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.notes).toBe("priority client");

    const deleteResponse = await request(app)
      .delete(`/api/clients/${clientId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(deleteResponse.status).toBe(204);

    const logRows = await pool.query<{ action: string }>(
      `SELECT action
       FROM activity_log
       WHERE action IN ('client_created', 'client_updated', 'client_deleted')
       ORDER BY created_at ASC`
    );

    expect(logRows.rows.map((row) => row.action)).toEqual([
      "client_created",
      "client_updated",
      "client_deleted"
    ]);
  });

  it("projects: CRUD + filters + phase transition rules + activity logs", async () => {
    const auth = await login();

    const clientResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ name: "Project Client" });

    expect(clientResponse.status).toBe(201);
    const clientId = clientResponse.body.data.id as string;

    const projectResponse = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        clientId,
        name: "Website Revamp",
        startDate: "2026-02-12",
        deadline: "2026-03-12",
        priority: "high"
      });

    expect(projectResponse.status).toBe(201);
    const projectId = projectResponse.body.data.id as string;

    const filteredList = await request(app)
      .get(`/api/projects?clientId=${clientId}&priority=high`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(filteredList.status).toBe(200);
    expect(filteredList.body.data.length).toBe(1);

    const updateResponse = await request(app)
      .put(`/api/projects/${projectId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ description: "Updated description" });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.description).toBe("Updated description");

    const validPhaseTransition = await request(app)
      .patch(`/api/projects/${projectId}/phase`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ phase: "strategy_planning", reason: "Initial kickoff complete" });

    expect(validPhaseTransition.status).toBe(200);
    expect(validPhaseTransition.body.data.current_phase).toBe("strategy_planning");

    const backwardTransition = await request(app)
      .patch(`/api/projects/${projectId}/phase`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ phase: "client_acquisition" });

    expect(backwardTransition.status).toBe(409);

    const skipTransition = await request(app)
      .patch(`/api/projects/${projectId}/phase`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ phase: "post_production" });

    expect(skipTransition.status).toBe(409);

    const deleteResponse = await request(app)
      .delete(`/api/projects/${projectId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(deleteResponse.status).toBe(204);

    const projectLogRows = await pool.query<{ action: string }>(
      `SELECT action
       FROM activity_log
       WHERE action IN ('project_created', 'project_updated', 'project_phase_changed', 'project_deleted')
       ORDER BY created_at ASC`
    );

    expect(projectLogRows.rows.map((row) => row.action)).toEqual([
      "project_created",
      "project_updated",
      "project_phase_changed",
      "project_deleted"
    ]);
  });
});
