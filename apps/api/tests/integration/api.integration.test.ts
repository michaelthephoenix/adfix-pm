import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { runMigrations } from "../../src/db/migrations.js";
import { seedDatabase } from "../../src/db/seed.js";
import { closeDatabase, pool } from "../../src/db/pool.js";
import {
  createNotificationsForUsers,
  resolveActionNotificationsForVersion
} from "../../src/services/notifications.service.js";
import { hashToken } from "../../src/utils/tokens.js";

type LoginResult = {
  accessToken: string;
  cookie: string;
};

const app = createApp();

const adminUser = {
  email: "admin@adfix.local",
  name: "Adfix Admin",
  password: "ChangeMe123!"
};

beforeAll(runMigrations);

async function resetDatabase() {
  await pool.query(
    `TRUNCATE TABLE workflow_mutation_keys, notification_outbox, notifications, activity_log, project_team, task_comments, files, tasks, projects, auth_sessions, clients, users RESTART IDENTITY CASCADE`
  );

  const passwordHash = await bcrypt.hash(adminUser.password, 12);

  await pool.query(
    `INSERT INTO users (email, name, password_hash, is_active, is_admin, created_at, updated_at)
     VALUES ($1, $2, $3, TRUE, TRUE, NOW(), NOW())`,
    [adminUser.email, adminUser.name, passwordHash]
  );
}

async function login(): Promise<LoginResult> {
  return loginAs(adminUser.email, adminUser.password);
}

async function loginAs(email: string, password: string): Promise<LoginResult> {
  const response = await request(app).post("/api/auth/login").send({
    email,
    password
  });

  expect(response.status).toBe(200);
  expect(response.body.accessToken).toBeTypeOf("string");
  expect(response.body.refreshToken).toBeUndefined();
  const refreshCookieHeader = response.headers["set-cookie"]?.[0];
  expect(refreshCookieHeader).toContain("HttpOnly");
  expect(refreshCookieHeader).toContain("SameSite=Strict");
  const cookie = refreshCookieHeader?.split(";")[0];
  expect(cookie).toBeTypeOf("string");
  if (!cookie) throw new Error("Login did not set a refresh cookie");

  return {
    accessToken: response.body.accessToken,
    cookie
  };
}

async function notificationRecipientEmails(type: string, versionId: string) {
  const result = await pool.query<{ email: string }>(
    `SELECT user_account.email
     FROM notifications notification
     INNER JOIN users user_account ON user_account.id = notification.user_id
     WHERE notification.type = $1
       AND notification.metadata->>'versionId' = $2
     ORDER BY user_account.email`,
    [type, versionId]
  );
  return result.rows.map((row) => row.email);
}

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeDatabase();
});

describe("API integration", () => {
  it("public: health + docs expose service metadata and request id", async () => {
    const healthResponse = await request(app).get("/api/health");
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.body.status).toBe("ok");
    expect(healthResponse.body.checks).toBeUndefined();
    expect(healthResponse.body).toHaveProperty("timestamp");
    expect(healthResponse.headers["x-request-id"]).toBeTypeOf("string");

    const readyResponse = await request(app).get("/api/ready");
    expect(readyResponse.status).toBe(200);
    expect(readyResponse.body.status).toBe("ok");
    expect(readyResponse.body.checks.database).toBe("ok");
    expect(readyResponse.body.checks.storage).toBe("ok");

    const docsResponse = await request(app).get("/api/docs.json");
    expect(docsResponse.status).toBe(200);
    expect(docsResponse.body.openapi).toBe("3.0.3");
    expect(docsResponse.body.info.title).toBe("Adfix PM API");
    expect(docsResponse.body.paths).toHaveProperty("/users/audit-logs");
    expect(docsResponse.body.paths).toHaveProperty("/tasks/bulk/status");
    expect(docsResponse.body.paths).toHaveProperty("/tasks/bulk/update");
    expect(docsResponse.body.paths["/projects/{id}/team/{userId}"]).toHaveProperty("patch");
    expect(docsResponse.body.paths).toHaveProperty("/tasks/{id}/comments");
    expect(docsResponse.body.paths).toHaveProperty("/notifications");
    expect(docsResponse.body.components.schemas).toHaveProperty("ErrorResponse");
  });

  it("public: versioned /api/v1 prefix supports docs, health, and auth", async () => {
    const healthResponse = await request(app).get("/api/v1/health");
    expect(healthResponse.status).toBe(200);
    expect(healthResponse.body.status).toBe("ok");

    const readyResponse = await request(app).get("/api/v1/ready");
    expect(readyResponse.status).toBe(200);
    expect(readyResponse.body.status).toBe("ok");
    expect(readyResponse.body.checks.database).toBe("ok");
    expect(readyResponse.body.checks.storage).toBe("ok");

    const docsResponse = await request(app).get("/api/v1/docs.json");
    expect(docsResponse.status).toBe(200);
    expect(docsResponse.body.servers[0].url).toContain("/api/v1");

    const loginResponse = await request(app).post("/api/v1/auth/login").send({
      email: adminUser.email,
      password: adminUser.password
    });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.accessToken).toBeTypeOf("string");
  });

  it("public: CORS preflight allows configured origins and blocks unknown origins", async () => {
    const allowedPreflight = await request(app)
      .options("/api/v1/auth/login")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "authorization,content-type");

    expect(allowedPreflight.status).toBe(204);
    expect(allowedPreflight.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(allowedPreflight.headers["access-control-allow-methods"]).toContain("POST");

    const deniedPreflight = await request(app)
      .options("/api/v1/auth/login")
      .set("Origin", "https://untrusted.example.com")
      .set("Access-Control-Request-Method", "POST");

    expect(deniedPreflight.status).toBe(403);
    expect(deniedPreflight.body.code).toBe("CORS_ORIGIN_DENIED");
  });

  it("auth: login, me, refresh, logout, logout-all", async () => {
    const firstLogin = await login();

    const meResponse = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${firstLogin.accessToken}`);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.user.email).toBe(adminUser.email);

    const refreshResponse = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", firstLogin.cookie)
      .send({});

    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body.refreshToken).toBeUndefined();
    const rotatedCookie = refreshResponse.headers["set-cookie"]?.[0]?.split(";")[0];
    expect(rotatedCookie).toBeTypeOf("string");
    if (!rotatedCookie) throw new Error("Refresh did not rotate the cookie");

    const logoutResponse = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", rotatedCookie)
      .send({});

    expect(logoutResponse.status).toBe(204);

    const revokedRefresh = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", rotatedCookie)
      .send({});

    expect(revokedRefresh.status).toBe(401);

    const sessionA = await login();
    const sessionB = await login();

    const logoutAll = await request(app)
      .post("/api/auth/logout-all")
      .set("Cookie", sessionA.cookie)
      .send({});

    expect(logoutAll.status).toBe(204);

    const refreshA = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", sessionA.cookie)
      .send({});

    const refreshB = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", sessionB.cookie)
      .send({});

    expect(refreshA.status).toBe(401);
    expect(refreshB.status).toBe(401);

    const authLogCounts = await pool.query<{ action: string; count: string }>(
      `SELECT action, COUNT(*)::text AS count
       FROM activity_log
       WHERE action IN ('auth_login', 'auth_refresh', 'auth_logout', 'auth_logout_all')
       GROUP BY action`
    );

    const counts = Object.fromEntries(
      authLogCounts.rows.map((row) => [row.action, Number(row.count)])
    );

    expect(counts.auth_login).toBe(3);
    expect(counts.auth_refresh).toBe(1);
    expect(counts.auth_logout).toBe(1);
    expect(counts.auth_logout_all).toBe(1);
  });

  it("auth: public staff signup is not available", async () => {
    const response = await request(app).post("/api/auth/signup").send({
      email: "signup-user@adfix.local",
      name: "Signup User",
      password: "SignupPass123!"
    });

    expect(response.status).toBe(404);
    const userCount = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM users WHERE email = 'signup-user@adfix.local'"
    );
    expect(Number(userCount.rows[0].count)).toBe(0);
  });

  it("bootstrap: seeding never resets an existing administrator password", async () => {
    const customPassword = "CustomAdminPass123!";
    const customHash = await bcrypt.hash(customPassword, 12);
    await pool.query("UPDATE users SET password_hash = $1 WHERE email = $2", [customHash, adminUser.email]);

    await seedDatabase("admin_only");

    const oldPasswordLogin = await request(app).post("/api/auth/login").send({
      email: adminUser.email,
      password: adminUser.password
    });
    expect(oldPasswordLogin.status).toBe(401);

    const customPasswordLogin = await request(app).post("/api/auth/login").send({
      email: adminUser.email,
      password: customPassword
    });
    expect(customPasswordLogin.status).toBe(200);
  });

  it("auth: refresh is cookie-only and detects token-family reuse", async () => {
    const original = await login();

    const bodyOnly = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: original.cookie.split("=")[1] });
    expect(bodyOnly.status).toBe(400);

    const firstRotation = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", original.cookie)
      .send({});
    expect(firstRotation.status).toBe(200);
    const currentCookie = firstRotation.headers["set-cookie"]?.[0]?.split(";")[0];
    if (!currentCookie) throw new Error("Refresh did not return a rotated cookie");

    const benignRace = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", original.cookie)
      .send({});
    expect(benignRace.status).toBe(409);
    expect(benignRace.body.code).toBe("REFRESH_ALREADY_ROTATED");
    expect(benignRace.headers["set-cookie"]).toBeUndefined();

    await pool.query(
      `UPDATE auth_sessions
       SET revoked_at = NOW() - INTERVAL '1 minute'
       WHERE refresh_token_hash = $1`,
      [hashToken(original.cookie.split("=")[1])]
    );

    const replay = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", original.cookie)
      .send({});
    expect(replay.status).toBe(401);
    expect(replay.headers["set-cookie"]?.[0]).toContain("Expires=Thu, 01 Jan 1970");

    const familyWasRevoked = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", currentCookie)
      .send({});
    expect(familyWasRevoked.status).toBe(401);
  });

  it("auth: password changes require the current password and invalidate every session", async () => {
    const sessionA = await login();
    const sessionB = await login();

    const incorrectCurrentPassword = await request(app)
      .post("/api/users/me/change-password")
      .set("Authorization", `Bearer ${sessionA.accessToken}`)
      .send({ currentPassword: "IncorrectPassword123!", newPassword: "PermanentPassword456!" });
    expect(incorrectCurrentPassword.status).toBe(400);
    expect(incorrectCurrentPassword.body.code).toBe("CURRENT_PASSWORD_INCORRECT");

    const reusedPassword = await request(app)
      .post("/api/users/me/change-password")
      .set("Authorization", `Bearer ${sessionA.accessToken}`)
      .send({ currentPassword: adminUser.password, newPassword: adminUser.password });
    expect(reusedPassword.status).toBe(409);
    expect(reusedPassword.body.code).toBe("PASSWORD_REUSE");

    const changed = await request(app)
      .post("/api/users/me/change-password")
      .set("Authorization", `Bearer ${sessionA.accessToken}`)
      .set("Cookie", sessionA.cookie)
      .send({ currentPassword: adminUser.password, newPassword: "PermanentPassword456!" });
    expect(changed.status).toBe(204);
    expect(changed.headers["set-cookie"]?.[0]).toContain("Expires=Thu, 01 Jan 1970");

    const oldAccess = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${sessionB.accessToken}`);
    expect(oldAccess.status).toBe(401);

    const oldRefresh = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", sessionB.cookie)
      .send({});
    expect(oldRefresh.status).toBe(401);

    const oldPasswordLogin = await request(app).post("/api/auth/login").send({
      email: adminUser.email,
      password: adminUser.password
    });
    expect(oldPasswordLogin.status).toBe(401);

    const newPasswordLogin = await request(app).post("/api/auth/login").send({
      email: adminUser.email,
      password: "PermanentPassword456!"
    });
    expect(newPasswordLogin.status).toBe(200);
    expect(newPasswordLogin.body.user.mustChangePassword).toBe(false);

    const account = await pool.query<{ auth_version: number; must_change_password: boolean }>(
      "SELECT auth_version, must_change_password FROM users WHERE email = $1",
      [adminUser.email]
    );
    expect(account.rows[0]).toMatchObject({ auth_version: 1, must_change_password: false });
  });

  it("auth: temporary staff credentials force a first-login password change", async () => {
    const admin = await login();
    const created = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        email: "temporary-staff@adfix.local",
        name: "Temporary Staff",
        password: "TemporaryPassword123!",
        isAdmin: false
      });
    expect(created.status).toBe(201);
    expect(created.body.data.must_change_password).toBe(true);

    const temporarySessionResponse = await request(app).post("/api/auth/login").send({
      email: "temporary-staff@adfix.local",
      password: "TemporaryPassword123!"
    });
    expect(temporarySessionResponse.status).toBe(200);
    expect(temporarySessionResponse.body.user.mustChangePassword).toBe(true);
    const temporaryAccess = temporarySessionResponse.body.accessToken as string;

    const workspaceBlocked = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${temporaryAccess}`);
    expect(workspaceBlocked.status).toBe(403);
    expect(workspaceBlocked.body.code).toBe("PASSWORD_CHANGE_REQUIRED");

    const sessionInspection = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${temporaryAccess}`);
    expect(sessionInspection.status).toBe(200);
    expect(sessionInspection.body.user.mustChangePassword).toBe(true);

    const changed = await request(app)
      .post("/api/users/me/change-password")
      .set("Authorization", `Bearer ${temporaryAccess}`)
      .send({ currentPassword: "TemporaryPassword123!", newPassword: "PermanentPassword456!" });
    expect(changed.status).toBe(204);

    const invalidatedAccess = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${temporaryAccess}`);
    expect(invalidatedAccess.status).toBe(401);

    const permanentSession = await request(app).post("/api/auth/login").send({
      email: "temporary-staff@adfix.local",
      password: "PermanentPassword456!"
    });
    expect(permanentSession.status).toBe(200);
    expect(permanentSession.body.user.mustChangePassword).toBe(false);
  });

  it("auth: administrators can recover a client account without leaking the temporary password", async () => {
    const passwordHash = await bcrypt.hash("ClientPassword123!", 12);
    await pool.query(
      `INSERT INTO users (email, name, password_hash, is_active, is_admin, account_type, created_at, updated_at)
       VALUES ('recovery-client@adfix.local', 'Recovery Client', $1, TRUE, FALSE, 'client', NOW(), NOW())`,
      [passwordHash]
    );
    const clientSession = await loginAs("recovery-client@adfix.local", "ClientPassword123!");
    const admin = await login();

    const nonAdminReset = await request(app)
      .post("/api/users/admin/password-reset")
      .set("Authorization", `Bearer ${clientSession.accessToken}`)
      .send({ email: adminUser.email });
    expect(nonAdminReset.status).toBe(403);

    const selfReset = await request(app)
      .post("/api/users/admin/password-reset")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ email: adminUser.email });
    expect(selfReset.status).toBe(409);

    const reset = await request(app)
      .post("/api/users/admin/password-reset")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ email: "recovery-client@adfix.local" });
    expect(reset.status).toBe(200);
    expect(reset.headers["cache-control"]).toBe("no-store");
    expect(reset.body.data.temporaryPassword).toBeTypeOf("string");
    expect(reset.body.data.mustChangePassword).toBe(true);
    const temporaryPassword = reset.body.data.temporaryPassword as string;

    const priorAccess = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${clientSession.accessToken}`);
    expect(priorAccess.status).toBe(401);
    const priorRefresh = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", clientSession.cookie)
      .send({});
    expect(priorRefresh.status).toBe(401);

    const oldPasswordLogin = await request(app).post("/api/auth/login").send({
      email: "recovery-client@adfix.local",
      password: "ClientPassword123!"
    });
    expect(oldPasswordLogin.status).toBe(401);

    const temporaryLogin = await request(app).post("/api/auth/login").send({
      email: "recovery-client@adfix.local",
      password: temporaryPassword
    });
    expect(temporaryLogin.status).toBe(200);
    expect(temporaryLogin.body.user.mustChangePassword).toBe(true);

    const clientWorkspaceBlocked = await request(app)
      .get("/api/client-portal/projects")
      .set("Authorization", `Bearer ${temporaryLogin.body.accessToken}`);
    expect(clientWorkspaceBlocked.status).toBe(403);
    expect(clientWorkspaceBlocked.body.code).toBe("PASSWORD_CHANGE_REQUIRED");

    const audit = await pool.query<{ details: Record<string, unknown> }>(
      "SELECT details FROM activity_log WHERE action = 'user_temporary_password_issued'"
    );
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0].details)).not.toContain(temporaryPassword);
  });

  it("clients: CRUD with activity logs", async () => {
    const auth = await login();

    const createResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ name: "Acme", company: "Acme Co" });

    expect(createResponse.status).toBe(201);
    const clientId = createResponse.body.data.id as string;

    const secondCreateResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ name: "Beta", company: "Beta Co" });
    expect(secondCreateResponse.status).toBe(201);

    const listResponse = await request(app)
      .get("/api/clients")
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body.data)).toBe(true);
    expect(listResponse.body.data.length).toBe(2);

    const sortedListResponse = await request(app)
      .get("/api/clients")
      .query({ sortBy: "name", sortOrder: "asc" })
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(sortedListResponse.status).toBe(200);
    expect(sortedListResponse.body.meta.sortBy).toBe("name");
    expect(sortedListResponse.body.meta.sortOrder).toBe("asc");
    expect(sortedListResponse.body.data[0].name).toBe("Acme");
    expect(sortedListResponse.body.data[1].name).toBe("Beta");

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
    expect(filteredList.body.data[0].current_user_role).toBe("owner");

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

    const phaseTasks = await request(app)
      .get(`/api/tasks?projectId=${projectId}&phase=strategy_planning`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(phaseTasks.status).toBe(200);
    expect(phaseTasks.body.data.length).toBe(3);

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

    const extraTask = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        projectId,
        title: "Task that should be hidden after project delete",
        phase: "strategy_planning"
      });
    expect(extraTask.status).toBe(201);

    const extraFile = await request(app)
      .post("/api/files/upload")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        projectId,
        fileName: "project-doc.pdf",
        fileType: "proposal",
        storageType: "s3",
        objectKey: "projects/test/project-doc.pdf",
        mimeType: "application/pdf",
        fileSize: 1000
      });
    expect(extraFile.status).toBe(201);

    const secondUserPasswordHash = await bcrypt.hash("ProjectTeam123!", 12);
    const secondUserInsert = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, is_active, created_at, updated_at)
       VALUES ('projectmember@adfix.local', 'Project Member', $1, TRUE, NOW(), NOW())
       RETURNING id`,
      [secondUserPasswordHash]
    );
    const secondUserId = secondUserInsert.rows[0].id;
    const addTeamMember = await request(app)
      .post(`/api/projects/${projectId}/team`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ userId: secondUserId, role: "member" });
    expect(addTeamMember.status).toBe(201);

    const deleteResponse = await request(app)
      .delete(`/api/projects/${projectId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(deleteResponse.status).toBe(204);

    const getDeletedProject = await request(app)
      .get(`/api/projects/${projectId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);
    expect(getDeletedProject.status).toBe(404);

    const tasksAfterProjectDelete = await request(app)
      .get(`/api/tasks?projectId=${projectId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);
    expect(tasksAfterProjectDelete.status).toBe(404);

    const filesAfterProjectDelete = await request(app)
      .get(`/api/files/project/${projectId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);
    expect(filesAfterProjectDelete.status).toBe(404);

    const teamAfterProjectDelete = await request(app)
      .get(`/api/projects/${projectId}/team`)
      .set("Authorization", `Bearer ${auth.accessToken}`);
    expect(teamAfterProjectDelete.status).toBe(404);

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

  it("projects: composite setup commits client, project, team, activity, and notifications atomically", async () => {
    const { accessToken } = await login();
    const passwordHash = await bcrypt.hash("TeamMemberPass123!", 12);
    const teamMember = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, is_active, is_admin, account_type, created_at, updated_at)
       VALUES ('setup-member@adfix.local', 'Setup Member', $1, TRUE, FALSE, 'staff', NOW(), NOW())
       RETURNING id`,
      [passwordHash]
    );

    const setupResponse = await request(app)
      .post("/api/projects/setup")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        newClient: { name: "Atomic Client", company: "Atomic Studio" },
        name: "Atomic Project",
        description: "Created in one transaction",
        priority: "high",
        startDate: "2026-07-21",
        deadline: "2026-08-21",
        team: [{ userId: teamMember.rows[0].id, role: "manager" }]
      });

    expect(setupResponse.status).toBe(201);
    expect(setupResponse.body.meta).toEqual({
      clientCreated: true,
      assignedTeamMemberCount: 1
    });
    const projectId = setupResponse.body.data.id as string;
    const committedState = await pool.query<{
      team_count: string;
      activity_count: string;
      notification_count: string;
    }>(
      `SELECT
         (SELECT COUNT(*)::text FROM project_team WHERE project_id = $1) AS team_count,
         (SELECT COUNT(*)::text FROM activity_log WHERE project_id = $1 AND action = 'project_created') AS activity_count,
         (SELECT COUNT(*)::text FROM notifications WHERE project_id = $1 AND type = 'project_team_assigned') AS notification_count`,
      [projectId]
    );
    expect(committedState.rows[0]).toEqual({
      team_count: "1",
      activity_count: "1",
      notification_count: "1"
    });

    const beforeFailure = await pool.query<{ client_count: string; project_count: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM clients) AS client_count,
         (SELECT COUNT(*)::text FROM projects) AS project_count`
    );
    const failedSetup = await request(app)
      .post("/api/projects/setup")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        newClient: { name: "Must Roll Back" },
        name: "Invalid Team Project",
        startDate: "2026-07-21",
        deadline: "2026-08-21",
        team: [{ userId: "00000000-0000-4000-8000-000000000099", role: "member" }]
      });

    expect(failedSetup.status).toBe(422);
    expect(failedSetup.body.code).toBe("INVALID_TEAM_MEMBERS");
    const afterFailure = await pool.query<{ client_count: string; project_count: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM clients) AS client_count,
         (SELECT COUNT(*)::text FROM projects) AS project_count`
    );
    expect(afterFailure.rows[0]).toEqual(beforeFailure.rows[0]);
  });

  it("tasks: CRUD + status transitions + project detail summary + activity logs", async () => {
    const auth = await login();

    const clientResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ name: "Tasks Client" });

    expect(clientResponse.status).toBe(201);
    const clientId = clientResponse.body.data.id as string;

    const projectResponse = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        clientId,
        name: "Tasks Project",
        startDate: "2026-02-12",
        deadline: "2026-03-30"
      });

    expect(projectResponse.status).toBe(201);
    const projectId = projectResponse.body.data.id as string;

    const adminIdResult = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [adminUser.email]);
    const collaboratorResult = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, is_active, created_at, updated_at)
       VALUES ('collaborator@adfix.local', 'Task Collaborator', 'not-used', TRUE, NOW(), NOW())
       RETURNING id`
    );
    const adminId = adminIdResult.rows[0].id;
    const collaboratorId = collaboratorResult.rows[0].id;

    const collaboratorMembership = await request(app)
      .post(`/api/projects/${projectId}/team`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ userId: collaboratorId, role: "member" });
    expect(collaboratorMembership.status).toBe(201);

    const taskA = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        projectId,
        title: "Overdue pending task",
        phase: "production",
        dueDate: "2020-01-01",
        assigneeIds: [adminId, collaboratorId],
        labels: [
          { name: "Client feedback", color: "violet" },
          { name: "Needs copy", color: "amber" }
        ]
      });

    const taskB = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        projectId,
        title: "Completable task",
        phase: "production"
      });

    const taskC = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        projectId,
        title: "Blockable task",
        phase: "production"
      });

    expect(taskA.status).toBe(201);
    expect(taskB.status).toBe(201);
    expect(taskC.status).toBe(201);

    const taskAId = taskA.body.data.id as string;
    const taskBId = taskB.body.data.id as string;
    const taskCId = taskC.body.data.id as string;

    expect(taskA.body.data.assignees.map((assignee: { id: string }) => assignee.id)).toEqual([adminId, collaboratorId]);
    expect(taskA.body.data.labels.map((label: { name: string }) => label.name)).toEqual(["Client feedback", "Needs copy"]);

    const collaboratorTasks = await request(app)
      .get(`/api/tasks?projectId=${projectId}&assignedTo=${collaboratorId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(collaboratorTasks.status).toBe(200);
    expect(collaboratorTasks.body.data.map((task: { id: string }) => task.id)).toContain(taskAId);

    const createComment = await request(app)
      .post(`/api/tasks/${taskBId}/comments`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ body: "Initial note on task B" });

    expect(createComment.status).toBe(201);
    expect(createComment.body.data.body).toBe("Initial note on task B");
    const taskBCommentId = createComment.body.data.id as string;

    const listComments = await request(app)
      .get(`/api/tasks/${taskBId}/comments`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(listComments.status).toBe(200);
    expect(listComments.body.data.length).toBe(1);
    expect(listComments.body.meta.total).toBe(1);
    expect(listComments.body.data[0].id).toBe(taskBCommentId);

    const updateTaskA = await request(app)
      .put(`/api/tasks/${taskAId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ description: "Updated details" });

    expect(updateTaskA.status).toBe(200);
    expect(updateTaskA.body.data.description).toBe("Updated details");

    const updateTaskCollaboration = await request(app)
      .put(`/api/tasks/${taskAId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        assigneeIds: [collaboratorId],
        labels: [
          { name: "Client feedback", color: "blue" },
          { name: "Ready for review", color: "green" }
        ]
      });

    expect(updateTaskCollaboration.status).toBe(200);
    expect(updateTaskCollaboration.body.data.assignees.map((assignee: { id: string }) => assignee.id)).toEqual([collaboratorId]);
    expect(updateTaskCollaboration.body.data.labels).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Client feedback", color: "blue" }),
      expect.objectContaining({ name: "Ready for review", color: "green" })
    ]));

    const taskBInProgress = await request(app)
      .patch(`/api/tasks/${taskBId}/status`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ status: "in_progress" });

    const taskBCompleted = await request(app)
      .patch(`/api/tasks/${taskBId}/status`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ status: "completed" });

    expect(taskBInProgress.status).toBe(200);
    expect(taskBCompleted.status).toBe(200);

    const taskCInProgress = await request(app)
      .patch(`/api/tasks/${taskCId}/status`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ status: "in_progress" });

    const taskCBlocked = await request(app)
      .patch(`/api/tasks/${taskCId}/status`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ status: "blocked" });

    expect(taskCInProgress.status).toBe(200);
    expect(taskCBlocked.status).toBe(200);

    const invalidTransition = await request(app)
      .patch(`/api/tasks/${taskAId}/status`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ status: "completed" });

    expect(invalidTransition.status).toBe(409);

    const completedTasks = await request(app)
      .get(`/api/tasks?projectId=${projectId}&status=completed`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    const overdueTasks = await request(app)
      .get(`/api/tasks?projectId=${projectId}&overdue=true`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(completedTasks.status).toBe(200);
    expect(overdueTasks.status).toBe(200);
    expect(completedTasks.body.data.length).toBe(1);
    expect(overdueTasks.body.data.length).toBe(1);

    const projectDetail = await request(app)
      .get(`/api/projects/${projectId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(projectDetail.status).toBe(200);
    expect(projectDetail.body.data.current_user_role).toBe("owner");
    expect(projectDetail.body.data.task_summary).toEqual({
      total: 3,
      pending: 1,
      in_progress: 0,
      completed: 1,
      blocked: 1,
      overdue: 1
    });

    const deleteTaskA = await request(app)
      .delete(`/api/tasks/${taskAId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(deleteTaskA.status).toBe(204);

    const getDeletedTaskA = await request(app)
      .get(`/api/tasks/${taskAId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(getDeletedTaskA.status).toBe(404);

    const deleteComment = await request(app)
      .delete(`/api/tasks/${taskBId}/comments/${taskBCommentId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(deleteComment.status).toBe(204);

    const taskActionCounts = await pool.query<{ action: string; count: string }>(
      `SELECT action, COUNT(*)::text AS count
       FROM activity_log
       WHERE action IN (
         'task_created',
         'task_updated',
         'task_status_changed',
         'task_deleted',
         'task_comment_created',
         'task_comment_deleted'
       )
       GROUP BY action`
    );

    const counts = Object.fromEntries(
      taskActionCounts.rows.map((row) => [row.action, Number(row.count)])
    );

    expect(counts.task_created).toBe(3);
    expect(counts.task_updated).toBe(2);
    expect(counts.task_status_changed).toBe(4);
    expect(counts.task_deleted).toBe(1);
    expect(counts.task_comment_created).toBe(1);
    expect(counts.task_comment_deleted).toBe(1);
  });

  it("files: upload metadata + link + list + delete with activity logs", async () => {
    const auth = await login();

    const clientResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ name: "Files Client" });

    expect(clientResponse.status).toBe(201);
    const clientId = clientResponse.body.data.id as string;

    const projectResponse = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        clientId,
        name: "Files Project",
        startDate: "2026-02-12",
        deadline: "2026-03-31"
      });

    expect(projectResponse.status).toBe(201);
    const projectId = projectResponse.body.data.id as string;

    const uploadResponse = await request(app)
      .post("/api/files/upload")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        projectId,
        fileName: "creative-brief.pdf",
        fileType: "creative_brief",
        storageType: "s3",
        objectKey: "projects/x/creative-brief.pdf",
        mimeType: "application/pdf",
        fileSize: 2048,
        checksumSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      });

    expect(uploadResponse.status).toBe(201);
    const uploadedFileId = uploadResponse.body.data.id as string;

    const linkResponse = await request(app)
      .post("/api/files/link")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        projectId,
        fileName: "asset-folder",
        fileType: "asset",
        storageType: "google_drive",
        externalUrl: "https://drive.google.com/file/d/abc123/view",
        mimeType: "application/vnd.google-apps.folder",
        fileSize: 1
      });

    expect(linkResponse.status).toBe(201);
    const linkedFileId = linkResponse.body.data.id as string;

    const reviewLinkResponse = await request(app)
      .post("/api/files/link")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        projectId,
        fileName: "campaign-review",
        fileType: "deliverable",
        storageType: "external",
        externalUrl: "https://review.example.com/campaign-v1",
        mimeType: "text/uri-list",
        fileSize: 39
      });

    expect(reviewLinkResponse.status).toBe(201);
    expect(reviewLinkResponse.body.data.external_url).toBe("https://review.example.com/campaign-v1");
    const reviewLinkFileId = reviewLinkResponse.body.data.id as string;

    const unsafeLinkResponse = await request(app)
      .post("/api/files/link")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        projectId,
        fileName: "unsafe-link",
        fileType: "deliverable",
        storageType: "external",
        externalUrl: "javascript:alert(1)",
        mimeType: "text/uri-list",
        fileSize: 19
      });

    expect(unsafeLinkResponse.status).toBe(400);

    const listResponse = await request(app)
      .get(`/api/files/project/${projectId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.length).toBe(3);

    const deleteResponse = await request(app)
      .delete(`/api/files/${linkedFileId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(deleteResponse.status).toBe(204);

    const deleteReviewLinkResponse = await request(app)
      .delete(`/api/files/${reviewLinkFileId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(deleteReviewLinkResponse.status).toBe(204);

    const listAfterDelete = await request(app)
      .get(`/api/files/project/${projectId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(listAfterDelete.status).toBe(200);
    expect(listAfterDelete.body.data.length).toBe(1);
    expect(listAfterDelete.body.data[0].id).toBe(uploadedFileId);

    const fileActionCounts = await pool.query<{ action: string; count: string }>(
      `SELECT action, COUNT(*)::text AS count
       FROM activity_log
       WHERE action IN ('file_uploaded', 'file_linked', 'file_deleted')
       GROUP BY action`
    );

    const counts = Object.fromEntries(
      fileActionCounts.rows.map((row) => [row.action, Number(row.count)])
    );

    expect(counts.file_uploaded).toBe(1);
    expect(counts.file_linked).toBe(2);
    expect(counts.file_deleted).toBe(2);
  });

  it("files: upload-url + complete-upload + download-url flow", async () => {
    const auth = await login();

    const clientResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ name: "Upload URL Client" });

    expect(clientResponse.status).toBe(201);
    const clientId = clientResponse.body.data.id as string;

    const projectResponse = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        clientId,
        name: "Upload URL Project",
        startDate: "2026-02-12",
        deadline: "2026-04-15"
      });

    expect(projectResponse.status).toBe(201);
    const projectId = projectResponse.body.data.id as string;

    const uploadUrlResponse = await request(app)
      .post("/api/files/upload-url")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        projectId,
        fileName: "deck.pdf",
        fileType: "proposal",
        storageType: "s3",
        mimeType: "application/pdf",
        fileSize: 4096
      });

    expect(uploadUrlResponse.status).toBe(200);
    expect(uploadUrlResponse.body.data.uploadUrl).toContain("uploads.adfix.local");
    expect(uploadUrlResponse.body.data.objectKey).toContain(`projects/${projectId}/uploads/`);

    const completeUploadResponse = await request(app)
      .post("/api/files/complete-upload")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        projectId,
        fileName: "deck.pdf",
        fileType: "proposal",
        storageType: "s3",
        mimeType: "application/pdf",
        fileSize: 4096,
        objectKey: uploadUrlResponse.body.data.objectKey,
        checksumSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      });

    expect(completeUploadResponse.status).toBe(201);
    const fileId = completeUploadResponse.body.data.id as string;

    const downloadUrlResponse = await request(app)
      .get(`/api/files/${fileId}/download-url`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(downloadUrlResponse.status).toBe(200);
    expect(downloadUrlResponse.body.data.downloadUrl).toContain("downloads.adfix.local");
    expect(downloadUrlResponse.body.data.fileId).toBe(fileId);
  });

  it("project activity endpoint + analytics endpoints", async () => {
    const auth = await login();

    const clientResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ name: "Analytics Client" });

    expect(clientResponse.status).toBe(201);
    const clientId = clientResponse.body.data.id as string;

    const projectResponse = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        clientId,
        name: "Analytics Project",
        startDate: "2026-02-12",
        deadline: "2026-03-31"
      });

    expect(projectResponse.status).toBe(201);
    const projectId = projectResponse.body.data.id as string;

    const taskResponse = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        projectId,
        title: "Analytics Task",
        phase: "production",
        dueDate: "2020-01-01"
      });

    expect(taskResponse.status).toBe(201);
    const taskId = taskResponse.body.data.id as string;

    const taskMove = await request(app)
      .patch(`/api/tasks/${taskId}/status`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ status: "in_progress" });

    expect(taskMove.status).toBe(200);

    const projectPhaseMove = await request(app)
      .patch(`/api/projects/${projectId}/phase`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ phase: "strategy_planning", reason: "progress update" });

    expect(projectPhaseMove.status).toBe(200);

    const activityResponse = await request(app)
      .get(`/api/projects/${projectId}/activity`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(activityResponse.status).toBe(200);
    expect(Array.isArray(activityResponse.body.data)).toBe(true);
    expect(activityResponse.body.data.length).toBeGreaterThan(0);
    expect(activityResponse.body.data[0]).toHaveProperty("action");
    expect(activityResponse.body.data[0]).toHaveProperty("details");

    const dashboardResponse = await request(app)
      .get("/api/analytics/dashboard")
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.body.data).toHaveProperty("projectsByPhase");
    expect(dashboardResponse.body.data).toHaveProperty("overdueTasksCount");
    expect(dashboardResponse.body.data.overdueTasksCount).toBeGreaterThanOrEqual(0);

    const projectsAnalyticsResponse = await request(app)
      .get("/api/analytics/projects")
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(projectsAnalyticsResponse.status).toBe(200);
    expect(Array.isArray(projectsAnalyticsResponse.body.data)).toBe(true);
    expect(projectsAnalyticsResponse.body.data.length).toBeGreaterThan(0);
    expect(projectsAnalyticsResponse.body.data[0]).toHaveProperty("completionRatePct");

    const teamAnalyticsResponse = await request(app)
      .get("/api/analytics/team")
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(teamAnalyticsResponse.status).toBe(200);
    expect(Array.isArray(teamAnalyticsResponse.body.data)).toBe(true);
    expect(teamAnalyticsResponse.body.data.length).toBeGreaterThan(0);
    expect(teamAnalyticsResponse.body.data[0]).toHaveProperty("totalTasks");

    const timelineAnalyticsResponse = await request(app)
      .get("/api/analytics/timeline")
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(timelineAnalyticsResponse.status).toBe(200);
    expect(Array.isArray(timelineAnalyticsResponse.body.data)).toBe(true);
    expect(timelineAnalyticsResponse.body.data.length).toBeGreaterThan(0);
    expect(timelineAnalyticsResponse.body.data[0]).toHaveProperty("daysRemaining");

    const projectsCsvResponse = await request(app)
      .get("/api/analytics/projects.csv")
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(projectsCsvResponse.status).toBe(200);
    expect(projectsCsvResponse.headers["content-type"]).toContain("text/csv");
    expect(projectsCsvResponse.text.split("\n")[0]).toBe(
      "projectId,projectName,currentPhase,totalTasks,completedTasks,completionRatePct"
    );

    const teamCsvResponse = await request(app)
      .get("/api/analytics/team.csv")
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(teamCsvResponse.status).toBe(200);
    expect(teamCsvResponse.headers["content-type"]).toContain("text/csv");
    expect(teamCsvResponse.text.split("\n")[0]).toBe(
      "userId,userName,userEmail,totalTasks,completedTasks,overdueTasks"
    );
  });

  it("users: list, get, update own profile, block updating others", async () => {
    const auth = await login();

    const meResponse = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(meResponse.status).toBe(200);
    const meId = meResponse.body.user.id as string;

    const secondUserPasswordHash = await bcrypt.hash("AnotherPass123!", 12);
    const secondUserInsert = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, is_active, created_at, updated_at)
       VALUES ('designer@adfix.local', 'Designer User', $1, TRUE, NOW(), NOW())
       RETURNING id`,
      [secondUserPasswordHash]
    );
    const secondUserId = secondUserInsert.rows[0].id;
    const listResponse = await request(app)
      .get("/api/users")
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(listResponse.status).toBe(200);
    expect(Array.isArray(listResponse.body.data)).toBe(true);
    expect(listResponse.body.data.length).toBe(2);

    const getResponse = await request(app)
      .get(`/api/users/${meId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.data.id).toBe(meId);

    const updateSelfResponse = await request(app)
      .put(`/api/users/${meId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        name: "Adfix Admin Updated",
        avatarUrl: "https://cdn.example.com/avatar.png"
      });

    expect(updateSelfResponse.status).toBe(200);
    expect(updateSelfResponse.body.data.name).toBe("Adfix Admin Updated");
    expect(updateSelfResponse.body.data.avatar_url).toBe("https://cdn.example.com/avatar.png");

    const updateOtherResponse = await request(app)
      .put(`/api/users/${secondUserId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ name: "Should Not Work" });

    expect(updateOtherResponse.status).toBe(403);

    const invalidPayloadResponse = await request(app)
      .put(`/api/users/${meId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ avatarUrl: "not-a-url" });

    expect(invalidPayloadResponse.status).toBe(400);
    expect(invalidPayloadResponse.body.code).toBe("VALIDATION_ERROR");
    expect(invalidPayloadResponse.body.error).toBe("Invalid user payload");
    expect(invalidPayloadResponse.body.details).toHaveProperty("fieldErrors");
  });

  it("admin controls: update user status, reset project roles, and query audit logs", async () => {
    const adminAuth = await login();
    const meResponse = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${adminAuth.accessToken}`);
    expect(meResponse.status).toBe(200);
    const adminUserId = meResponse.body.user.id as string;

    const memberPasswordHash = await bcrypt.hash("MemberPass123!", 12);
    const memberInsert = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, is_active, created_at, updated_at)
       VALUES ('member-admin-controls@adfix.local', 'Member Controls', $1, TRUE, NOW(), NOW())
       RETURNING id`,
      [memberPasswordHash]
    );
    const memberId = memberInsert.rows[0].id;
    const memberAuth = await loginAs("member-admin-controls@adfix.local", "MemberPass123!");

    const outsiderPasswordHash = await bcrypt.hash("OutsiderPass123!", 12);
    await pool.query(
      `INSERT INTO users (email, name, password_hash, is_active, created_at, updated_at)
       VALUES ('outsider-admin-controls@adfix.local', 'Outsider Controls', $1, TRUE, NOW(), NOW())`,
      [outsiderPasswordHash]
    );
    const outsiderAuth = await loginAs("outsider-admin-controls@adfix.local", "OutsiderPass123!");

    const outsiderCreateStaff = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${outsiderAuth.accessToken}`)
      .send({ name: "Blocked Staff", email: "blocked-staff@adfix.local", password: "BlockedPass123!" });
    expect(outsiderCreateStaff.status).toBe(403);

    const createStaff = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminAuth.accessToken}`)
      .send({ name: "Created Staff", email: "created-staff@adfix.local", password: "CreatedPass123!", isAdmin: false });
    expect(createStaff.status).toBe(201);
    expect(createStaff.body.data.account_type).toBe("staff");
    expect(createStaff.body.data.is_admin).toBe(false);

    const duplicateStaff = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminAuth.accessToken}`)
      .send({ name: "Created Staff", email: "created-staff@adfix.local", password: "CreatedPass123!" });
    expect(duplicateStaff.status).toBe(409);

    const createdStaffAuth = await loginAs("created-staff@adfix.local", "CreatedPass123!");
    const createdStaffMe = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${createdStaffAuth.accessToken}`);
    expect(createdStaffMe.status).toBe(200);
    expect(createdStaffMe.body.user.accountType).toBe("staff");

    const clientResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${adminAuth.accessToken}`)
      .send({ name: "Admin Controls Client" });
    expect(clientResponse.status).toBe(201);
    const clientId = clientResponse.body.data.id as string;

    const projectResponse = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${adminAuth.accessToken}`)
      .send({
        clientId,
        name: "Admin Controls Project",
        startDate: "2026-02-12",
        deadline: "2026-04-10"
      });
    expect(projectResponse.status).toBe(201);
    const projectId = projectResponse.body.data.id as string;

    const addMemberToProject = await request(app)
      .post(`/api/projects/${projectId}/team`)
      .set("Authorization", `Bearer ${adminAuth.accessToken}`)
      .send({ userId: memberId, role: "member" });
    expect(addMemberToProject.status).toBe(201);

    const outsiderStatusPatch = await request(app)
      .patch(`/api/users/${memberId}/status`)
      .set("Authorization", `Bearer ${outsiderAuth.accessToken}`)
      .send({ isActive: false });
    expect(outsiderStatusPatch.status).toBe(403);
    expect(outsiderStatusPatch.body.code).toBe("FORBIDDEN");

    const statusPatch = await request(app)
      .patch(`/api/users/${memberId}/status`)
      .set("Authorization", `Bearer ${adminAuth.accessToken}`)
      .send({ isActive: false });
    expect(statusPatch.status).toBe(200);
    expect(statusPatch.body.data.is_active).toBe(false);

    const deactivatedAccess = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${memberAuth.accessToken}`);
    expect(deactivatedAccess.status).toBe(401);

    const deactivatedRefresh = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", memberAuth.cookie)
      .send({});
    expect(deactivatedRefresh.status).toBe(401);
    const activeSessionCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM auth_sessions
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [memberId]
    );
    expect(Number(activeSessionCount.rows[0].count)).toBe(0);

    const resetRoles = await request(app)
      .post(`/api/users/${memberId}/project-roles/reset`)
      .set("Authorization", `Bearer ${adminAuth.accessToken}`)
      .send({ projectId });
    expect(resetRoles.status).toBe(200);
    expect(resetRoles.body.data.removedCount).toBe(1);

    const listTeamAfterReset = await request(app)
      .get(`/api/projects/${projectId}/team`)
      .set("Authorization", `Bearer ${adminAuth.accessToken}`);
    expect(listTeamAfterReset.status).toBe(200);
    expect(listTeamAfterReset.body.data).toHaveLength(1);
    expect(listTeamAfterReset.body.data[0]).toMatchObject({ user_id: adminUserId, role: "owner" });

    const auditLogsResponse = await request(app)
      .get("/api/users/audit-logs")
      .query({ action: "user_status_changed", userId: adminUserId })
      .set("Authorization", `Bearer ${adminAuth.accessToken}`);
    expect(auditLogsResponse.status).toBe(200);
    expect(Array.isArray(auditLogsResponse.body.data)).toBe(true);
    expect(auditLogsResponse.body.data.length).toBeGreaterThan(0);

    const outsiderAuditLogsResponse = await request(app)
      .get("/api/users/audit-logs")
      .set("Authorization", `Bearer ${outsiderAuth.accessToken}`);
    expect(outsiderAuditLogsResponse.status).toBe(403);
    expect(outsiderAuditLogsResponse.body.code).toBe("FORBIDDEN");
  });

  it("project team: add/list/remove members with activity logs", async () => {
    const auth = await login();

    const meResponse = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(meResponse.status).toBe(200);
    const ownerUserId = meResponse.body.user.id as string;

    const secondUserPasswordHash = await bcrypt.hash("TeamUserPass123!", 12);
    const secondUserInsert = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, is_active, created_at, updated_at)
       VALUES ('teammate@adfix.local', 'Teammate User', $1, TRUE, NOW(), NOW())
       RETURNING id`,
      [secondUserPasswordHash]
    );
    const secondUserId = secondUserInsert.rows[0].id;
    const thirdUserInsert = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, is_active, created_at, updated_at)
       VALUES ('team-peer@adfix.local', 'Team Peer', $1, TRUE, NOW(), NOW())
       RETURNING id`,
      [secondUserPasswordHash]
    );
    const thirdUserId = thirdUserInsert.rows[0].id;
    const clientUserInsert = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, is_active, account_type, created_at, updated_at)
       VALUES ('team-client@adfix.local', 'Client Contact', $1, TRUE, 'client', NOW(), NOW())
       RETURNING id`,
      [secondUserPasswordHash]
    );
    const clientUserId = clientUserInsert.rows[0].id;

    const clientResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ name: "Team Client" });

    expect(clientResponse.status).toBe(201);
    const clientId = clientResponse.body.data.id as string;

    const projectResponse = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        clientId,
        name: "Team Project",
        startDate: "2026-02-12",
        deadline: "2026-04-01"
      });

    expect(projectResponse.status).toBe(201);
    const projectId = projectResponse.body.data.id as string;

    const clientCannotJoinInternalTeam = await request(app)
      .post(`/api/projects/${projectId}/team`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ userId: clientUserId, role: "member" });
    expect(clientCannotJoinInternalTeam.status).toBe(404);

    const outsiderCannotBeAssigned = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        projectId,
        title: "Invalid outsider assignment",
        phase: "production",
        assigneeIds: [secondUserId]
      });
    expect(outsiderCannotBeAssigned.status).toBe(409);

    const addMemberResponse = await request(app)
      .post(`/api/projects/${projectId}/team`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        userId: secondUserId,
        role: "member"
      });

    expect(addMemberResponse.status).toBe(201);
    expect(addMemberResponse.body.data.user_id).toBe(secondUserId);
    expect(addMemberResponse.body.data.role).toBe("member");

    const addPeerResponse = await request(app)
      .post(`/api/projects/${projectId}/team`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ userId: thirdUserId, role: "member" });
    expect(addPeerResponse.status).toBe(201);

    const assignedTask = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        projectId,
        title: "Assigned production task",
        phase: "production",
        assigneeIds: [secondUserId]
      });
    expect(assignedTask.status).toBe(201);

    const teammateAuth = await loginAs("teammate@adfix.local", "TeamUserPass123!");
    const peerAuth = await loginAs("team-peer@adfix.local", "TeamUserPass123!");

    const promotePeer = await request(app)
      .patch(`/api/projects/${projectId}/team/${thirdUserId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ role: "manager" });
    expect(promotePeer.status).toBe(200);
    expect(promotePeer.body.data).toMatchObject({ user_id: thirdUserId, role: "manager" });

    await pool.query("UPDATE users SET is_active = FALSE WHERE id = $1", [ownerUserId]);
    const lastSupervisorCannotBeDemoted = await request(app)
      .patch(`/api/projects/${projectId}/team/${thirdUserId}`)
      .set("Authorization", `Bearer ${peerAuth.accessToken}`)
      .send({ role: "member" });
    expect(lastSupervisorCannotBeDemoted.status).toBe(409);
    expect(lastSupervisorCannotBeDemoted.body).toMatchObject({ code: "CONFLICT", error: expect.stringContaining("another active project supervisor") });
    const lastSupervisorCannotBeRemoved = await request(app)
      .delete(`/api/projects/${projectId}/team/${thirdUserId}`)
      .set("Authorization", `Bearer ${peerAuth.accessToken}`);
    expect(lastSupervisorCannotBeRemoved.status).toBe(409);
    expect(lastSupervisorCannotBeRemoved.body).toMatchObject({ code: "CONFLICT", error: expect.stringContaining("another active project supervisor") });
    await pool.query("UPDATE users SET is_active = TRUE WHERE id = $1", [ownerUserId]);
    const demotePeer = await request(app)
      .patch(`/api/projects/${projectId}/team/${thirdUserId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ role: "member" });
    expect(demotePeer.status).toBe(200);

    const teammateComment = await request(app)
      .post(`/api/tasks/${assignedTask.body.data.id}/comments`)
      .set("Authorization", `Bearer ${teammateAuth.accessToken}`)
      .send({ body: "Author-owned task note" });
    expect(teammateComment.status).toBe(201);
    const peerCannotDeleteComment = await request(app)
      .delete(`/api/tasks/${assignedTask.body.data.id}/comments/${teammateComment.body.data.id}`)
      .set("Authorization", `Bearer ${peerAuth.accessToken}`);
    expect(peerCannotDeleteComment.status).toBe(403);
    const supervisorCanDeleteComment = await request(app)
      .delete(`/api/tasks/${assignedTask.body.data.id}/comments/${teammateComment.body.data.id}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);
    expect(supervisorCanDeleteComment.status).toBe(204);

    const otherClient = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ name: "Restricted Move Client" });
    const otherProject = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        clientId: otherClient.body.data.id,
        name: "Restricted Move Project",
        startDate: "2026-02-12",
        deadline: "2026-04-01"
      });
    const unauthorizedProjectMove = await request(app)
      .put(`/api/tasks/${assignedTask.body.data.id}`)
      .set("Authorization", `Bearer ${teammateAuth.accessToken}`)
      .send({ projectId: otherProject.body.data.id });
    expect(unauthorizedProjectMove.status).toBe(403);

    const listMembersResponse = await request(app)
      .get(`/api/projects/${projectId}/team`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(listMembersResponse.status).toBe(200);
    expect(Array.isArray(listMembersResponse.body.data)).toBe(true);
    expect(listMembersResponse.body.data.length).toBe(3);
    expect(listMembersResponse.body.data[0]).toMatchObject({ role: "owner" });
    expect(listMembersResponse.body.data.map((member: { user_id: string }) => member.user_id)).toEqual(
      expect.arrayContaining([secondUserId, thirdUserId])
    );
    expect(listMembersResponse.body.data.find((member: { user_id: string }) => member.user_id === secondUserId)).toMatchObject({
      assigned_task_count: "1",
      open_task_count: "1",
      overdue_task_count: "0"
    });
    expect(listMembersResponse.body.data.find((member: { user_id: string }) => member.user_id === thirdUserId)).toMatchObject({ role: "member" });

    const assignedMemberRemoval = await request(app)
      .delete(`/api/projects/${projectId}/team/${secondUserId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);
    expect(assignedMemberRemoval.status).toBe(409);

    const clearAssignment = await request(app)
      .put(`/api/tasks/${assignedTask.body.data.id}`)
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ assigneeIds: [] });
    expect(clearAssignment.status).toBe(200);

    const removeMemberResponse = await request(app)
      .delete(`/api/projects/${projectId}/team/${secondUserId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(removeMemberResponse.status).toBe(204);

    const listAfterRemoveResponse = await request(app)
      .get(`/api/projects/${projectId}/team`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(listAfterRemoveResponse.status).toBe(200);
    expect(listAfterRemoveResponse.body.data).toHaveLength(2);
    expect(listAfterRemoveResponse.body.data[0]).toMatchObject({ role: "owner" });

    const teamActivityRows = await pool.query<{ action: string }>(
      `SELECT action
       FROM activity_log
       WHERE project_id = $1
         AND action IN ('project_team_member_added', 'project_team_member_removed')
       ORDER BY created_at ASC`,
      [projectId]
    );

    expect(teamActivityRows.rows.map((row) => row.action)).toEqual([
      "project_team_member_added",
      "project_team_member_added",
      "project_team_member_removed"
    ]);
  });

  it("rbac: viewer can read project resources but cannot mutate", async () => {
    const ownerAuth = await login();

    const viewerEmail = "viewer@adfix.local";
    const viewerPassword = "ViewerPass123!";
    const viewerPasswordHash = await bcrypt.hash(viewerPassword, 12);
    const viewerInsert = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, is_active, created_at, updated_at)
       VALUES ($1, 'Viewer User', $2, TRUE, NOW(), NOW())
       RETURNING id`,
      [viewerEmail, viewerPasswordHash]
    );
    const viewerId = viewerInsert.rows[0].id;

    const clientResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${ownerAuth.accessToken}`)
      .send({ name: "RBAC Client" });
    expect(clientResponse.status).toBe(201);
    const clientId = clientResponse.body.data.id as string;

    const projectResponse = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${ownerAuth.accessToken}`)
      .send({
        clientId,
        name: "RBAC Project",
        startDate: "2026-02-12",
        deadline: "2026-04-05"
      });
    expect(projectResponse.status).toBe(201);
    const projectId = projectResponse.body.data.id as string;

    const taskResponse = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${ownerAuth.accessToken}`)
      .send({
        projectId,
        title: "Owner Task",
        phase: "production"
      });
    expect(taskResponse.status).toBe(201);
    const taskId = taskResponse.body.data.id as string;

    const fileResponse = await request(app)
      .post("/api/files/upload")
      .set("Authorization", `Bearer ${ownerAuth.accessToken}`)
      .send({
        projectId,
        fileName: "viewer-visible.pdf",
        fileType: "proposal",
        storageType: "s3",
        objectKey: "projects/x/viewer-visible.pdf",
        mimeType: "application/pdf",
        fileSize: 1024
      });
    expect(fileResponse.status).toBe(201);

    const addViewerResponse = await request(app)
      .post(`/api/projects/${projectId}/team`)
      .set("Authorization", `Bearer ${ownerAuth.accessToken}`)
      .send({
        userId: viewerId,
        role: "viewer"
      });
    expect(addViewerResponse.status).toBe(201);

    const viewerCannotBeAssigned = await request(app)
      .put(`/api/tasks/${taskId}`)
      .set("Authorization", `Bearer ${ownerAuth.accessToken}`)
      .send({ assigneeIds: [viewerId] });
    expect(viewerCannotBeAssigned.status).toBe(409);

    const viewerAuth = await loginAs(viewerEmail, viewerPassword);

    const listProjectsResponse = await request(app)
      .get("/api/projects")
      .set("Authorization", `Bearer ${viewerAuth.accessToken}`);
    expect(listProjectsResponse.status).toBe(200);
    expect(listProjectsResponse.body.data.length).toBe(1);
    expect(listProjectsResponse.body.data[0].id).toBe(projectId);

    const getProjectResponse = await request(app)
      .get(`/api/projects/${projectId}`)
      .set("Authorization", `Bearer ${viewerAuth.accessToken}`);
    expect(getProjectResponse.status).toBe(200);
    expect(getProjectResponse.body.data.current_user_role).toBe("viewer");

    const listTasksResponse = await request(app)
      .get(`/api/tasks?projectId=${projectId}`)
      .set("Authorization", `Bearer ${viewerAuth.accessToken}`);
    expect(listTasksResponse.status).toBe(200);
    expect(listTasksResponse.body.data.length).toBe(1);

    const ownerComment = await request(app)
      .post(`/api/tasks/${taskId}/comments`)
      .set("Authorization", `Bearer ${ownerAuth.accessToken}`)
      .send({ body: "Owner-only mutation note" });
    expect(ownerComment.status).toBe(201);
    const commentId = ownerComment.body.data.id as string;

    const viewerCommentsList = await request(app)
      .get(`/api/tasks/${taskId}/comments`)
      .set("Authorization", `Bearer ${viewerAuth.accessToken}`);
    expect(viewerCommentsList.status).toBe(200);
    expect(viewerCommentsList.body.data.length).toBe(1);
    expect(viewerCommentsList.body.data[0].id).toBe(commentId);

    const listFilesResponse = await request(app)
      .get(`/api/files/project/${projectId}`)
      .set("Authorization", `Bearer ${viewerAuth.accessToken}`);
    expect(listFilesResponse.status).toBe(200);
    expect(listFilesResponse.body.data.length).toBe(1);

    const viewerProjectUpdate = await request(app)
      .put(`/api/projects/${projectId}`)
      .set("Authorization", `Bearer ${viewerAuth.accessToken}`)
      .send({ description: "viewer should not update" });
    expect(viewerProjectUpdate.status).toBe(403);

    const viewerTaskCreate = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${viewerAuth.accessToken}`)
      .send({
        projectId,
        title: "Viewer cannot create",
        phase: "production"
      });
    expect(viewerTaskCreate.status).toBe(403);

    const viewerTaskDelete = await request(app)
      .delete(`/api/tasks/${taskId}`)
      .set("Authorization", `Bearer ${viewerAuth.accessToken}`);
    expect(viewerTaskDelete.status).toBe(403);

    const viewerCommentCreate = await request(app)
      .post(`/api/tasks/${taskId}/comments`)
      .set("Authorization", `Bearer ${viewerAuth.accessToken}`)
      .send({ body: "viewer should not comment" });
    expect(viewerCommentCreate.status).toBe(403);

    const viewerCommentDelete = await request(app)
      .delete(`/api/tasks/${taskId}/comments/${commentId}`)
      .set("Authorization", `Bearer ${viewerAuth.accessToken}`);
    expect(viewerCommentDelete.status).toBe(403);

    const viewerFileUpload = await request(app)
      .post("/api/files/upload")
      .set("Authorization", `Bearer ${viewerAuth.accessToken}`)
      .send({
        projectId,
        fileName: "viewer-cannot-upload.pdf",
        fileType: "proposal",
        storageType: "s3",
        objectKey: "projects/x/viewer-cannot-upload.pdf",
        mimeType: "application/pdf",
        fileSize: 1024
      });
    expect(viewerFileUpload.status).toBe(403);

    const authzDeniedLogs = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM activity_log
       WHERE action = 'authz_denied'
         AND project_id = $1`,
      [projectId]
    );
    expect(Number(authzDeniedLogs.rows[0].count)).toBeGreaterThanOrEqual(4);
  });

  it("notifications: assignment events create inbox items and support read actions", async () => {
    const ownerAuth = await login();

    const assigneeEmail = "notify-member@adfix.local";
    const assigneePassword = "NotifyPass123!";
    const assigneePasswordHash = await bcrypt.hash(assigneePassword, 12);
    const assigneeInsert = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, is_active, created_at, updated_at)
       VALUES ($1, 'Notify Member', $2, TRUE, NOW(), NOW())
       RETURNING id`,
      [assigneeEmail, assigneePasswordHash]
    );
    const assigneeId = assigneeInsert.rows[0].id;

    const clientResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${ownerAuth.accessToken}`)
      .send({ name: "Notifications Client" });
    expect(clientResponse.status).toBe(201);
    const clientId = clientResponse.body.data.id as string;

    const projectResponse = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${ownerAuth.accessToken}`)
      .send({
        clientId,
        name: "Notifications Project",
        startDate: "2026-02-12",
        deadline: "2026-05-01"
      });
    expect(projectResponse.status).toBe(201);
    const projectId = projectResponse.body.data.id as string;

    const addMemberResponse = await request(app)
      .post(`/api/projects/${projectId}/team`)
      .set("Authorization", `Bearer ${ownerAuth.accessToken}`)
      .send({ userId: assigneeId, role: "member" });
    expect(addMemberResponse.status).toBe(201);

    const phaseTransitionResponse = await request(app)
      .patch(`/api/projects/${projectId}/phase`)
      .set("Authorization", `Bearer ${ownerAuth.accessToken}`)
      .send({ phase: "strategy_planning", reason: "Milestone reached" });
    expect(phaseTransitionResponse.status).toBe(200);

    const taskResponse = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${ownerAuth.accessToken}`)
      .send({
        projectId,
        title: "Assigned task notification",
        phase: "production",
        assignedTo: assigneeId
      });
    expect(taskResponse.status).toBe(201);

    const assigneeAuth = await loginAs(assigneeEmail, assigneePassword);

    const listResponse = await request(app)
      .get("/api/notifications")
      .set("Authorization", `Bearer ${assigneeAuth.accessToken}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.length).toBe(3);
    expect(listResponse.body.meta.unreadCount).toBe(3);
    expect(listResponse.body.data[0].type).toBe("task_assigned");
    expect(listResponse.body.data.some((item: { type: string }) => item.type === "project_team_assigned")).toBe(true);
    expect(listResponse.body.data.some((item: { type: string }) => item.type === "project_milestone_reached")).toBe(true);

    const markReadResponse = await request(app)
      .patch(`/api/notifications/${listResponse.body.data[0].id}/read`)
      .set("Authorization", `Bearer ${assigneeAuth.accessToken}`);

    expect(markReadResponse.status).toBe(200);
    expect(markReadResponse.body.data.is_read).toBe(true);
    expect(markReadResponse.body.data.read_at).toBeTypeOf("string");

    const unreadOnlyResponse = await request(app)
      .get("/api/notifications")
      .query({ unreadOnly: true })
      .set("Authorization", `Bearer ${assigneeAuth.accessToken}`);

    expect(unreadOnlyResponse.status).toBe(200);
    expect(unreadOnlyResponse.body.data.length).toBe(2);
    expect(unreadOnlyResponse.body.meta.unreadCount).toBe(2);

    const readAllResponse = await request(app)
      .post("/api/notifications/read-all")
      .set("Authorization", `Bearer ${assigneeAuth.accessToken}`);

    expect(readAllResponse.status).toBe(200);
    expect(readAllResponse.body.data.updatedCount).toBe(2);

    const unreadAfterReadAll = await request(app)
      .get("/api/notifications")
      .query({ unreadOnly: true })
      .set("Authorization", `Bearer ${assigneeAuth.accessToken}`);

    expect(unreadAfterReadAll.status).toBe(200);
    expect(unreadAfterReadAll.body.data.length).toBe(0);
    expect(unreadAfterReadAll.body.meta.unreadCount).toBe(0);

    for (const status of ["in_progress", "completed"]) {
      const transition = await request(app)
        .patch(`/api/tasks/${taskResponse.body.data.id}/status`)
        .set("Authorization", `Bearer ${assigneeAuth.accessToken}`)
        .send({ status });
      expect(transition.status).toBe(200);
    }
    const resolvedActions = await request(app)
      .get("/api/notifications?actionStatus=resolved&pageSize=50")
      .set("Authorization", `Bearer ${assigneeAuth.accessToken}`);
    expect(resolvedActions.status).toBe(200);
    expect(resolvedActions.body.data.some((item: { type: string }) => item.type === "task_assigned")).toBe(true);
  });

  it("search: global and scoped search across projects/tasks/files/clients", async () => {
    const auth = await login();

    const clientResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ name: "Searchable Client" });

    expect(clientResponse.status).toBe(201);
    const clientId = clientResponse.body.data.id as string;

    const projectResponse = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        clientId,
        name: "Searchable Project",
        description: "Campaign plan document",
        startDate: "2026-02-12",
        deadline: "2026-04-01"
      });

    expect(projectResponse.status).toBe(201);
    const projectId = projectResponse.body.data.id as string;

    const taskResponse = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        projectId,
        title: "Searchable Task",
        description: "Storyboard for searchable campaign",
        phase: "production"
      });

    expect(taskResponse.status).toBe(201);

    const fileResponse = await request(app)
      .post("/api/files/upload")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        projectId,
        fileName: "searchable-brief.pdf",
        fileType: "creative_brief",
        storageType: "s3",
        objectKey: "projects/x/searchable-brief.pdf",
        mimeType: "application/pdf",
        fileSize: 1024
      });

    expect(fileResponse.status).toBe(201);

    const globalSearch = await request(app)
      .get("/api/search")
      .query({ q: "searchable", scope: "all" })
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(globalSearch.status).toBe(200);
    expect(globalSearch.body.data.clients.length).toBeGreaterThan(0);
    expect(globalSearch.body.data.projects.length).toBeGreaterThan(0);
    expect(globalSearch.body.data.tasks.length).toBeGreaterThan(0);
    expect(globalSearch.body.data.files.length).toBeGreaterThan(0);

    const projectsOnlySearch = await request(app)
      .get("/api/search")
      .query({ q: "searchable", scope: "projects" })
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(projectsOnlySearch.status).toBe(200);
    expect(projectsOnlySearch.body.data.projects.length).toBeGreaterThan(0);
    expect(projectsOnlySearch.body.data.tasks.length).toBe(0);
    expect(projectsOnlySearch.body.data.files.length).toBe(0);
    expect(projectsOnlySearch.body.data.clients.length).toBe(0);
  });

  it("rbac: analytics and search are scoped to accessible projects", async () => {
    const ownerAuth = await login();

    const outsiderEmail = "outsider@adfix.local";
    const outsiderPassword = "OutsiderPass123!";
    const outsiderPasswordHash = await bcrypt.hash(outsiderPassword, 12);
    await pool.query(
      `INSERT INTO users (email, name, password_hash, is_active, created_at, updated_at)
       VALUES ($1, 'Outsider User', $2, TRUE, NOW(), NOW())`,
      [outsiderEmail, outsiderPasswordHash]
    );
    const outsiderAuth = await loginAs(outsiderEmail, outsiderPassword);

    const ownerClientResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${ownerAuth.accessToken}`)
      .send({ name: "Owner Scoped Client" });
    expect(ownerClientResponse.status).toBe(201);
    const ownerClientId = ownerClientResponse.body.data.id as string;

    const ownerProjectResponse = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${ownerAuth.accessToken}`)
      .send({
        clientId: ownerClientId,
        name: "Scoped Project Alpha",
        description: "Scoped keyword",
        startDate: "2026-02-12",
        deadline: "2026-04-12"
      });
    expect(ownerProjectResponse.status).toBe(201);
    const ownerProjectId = ownerProjectResponse.body.data.id as string;

    const ownerTaskResponse = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${ownerAuth.accessToken}`)
      .send({
        projectId: ownerProjectId,
        title: "Scoped Task Alpha",
        description: "Scoped keyword task",
        phase: "production"
      });
    expect(ownerTaskResponse.status).toBe(201);

    const ownerFileResponse = await request(app)
      .post("/api/files/upload")
      .set("Authorization", `Bearer ${ownerAuth.accessToken}`)
      .send({
        projectId: ownerProjectId,
        fileName: "scoped-alpha.pdf",
        fileType: "proposal",
        storageType: "s3",
        objectKey: "projects/owner/scoped-alpha.pdf",
        mimeType: "application/pdf",
        fileSize: 1000
      });
    expect(ownerFileResponse.status).toBe(201);

    const outsiderClientResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${outsiderAuth.accessToken}`)
      .send({ name: "Outsider Scoped Client" });
    expect(outsiderClientResponse.status).toBe(201);
    const outsiderClientId = outsiderClientResponse.body.data.id as string;

    const outsiderProjectResponse = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${outsiderAuth.accessToken}`)
      .send({
        clientId: outsiderClientId,
        name: "Scoped Project Beta",
        description: "Scoped keyword",
        startDate: "2026-02-12",
        deadline: "2026-04-12"
      });
    expect(outsiderProjectResponse.status).toBe(201);
    const outsiderProjectId = outsiderProjectResponse.body.data.id as string;

    const outsiderTaskResponse = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${outsiderAuth.accessToken}`)
      .send({
        projectId: outsiderProjectId,
        title: "Scoped Task Beta",
        description: "Scoped keyword task",
        phase: "production"
      });
    expect(outsiderTaskResponse.status).toBe(201);

    const outsiderFileResponse = await request(app)
      .post("/api/files/upload")
      .set("Authorization", `Bearer ${outsiderAuth.accessToken}`)
      .send({
        projectId: outsiderProjectId,
        fileName: "scoped-beta.pdf",
        fileType: "proposal",
        storageType: "s3",
        objectKey: "projects/outsider/scoped-beta.pdf",
        mimeType: "application/pdf",
        fileSize: 1000
      });
    expect(outsiderFileResponse.status).toBe(201);

    const ownerSearch = await request(app)
      .get("/api/search")
      .query({ q: "scoped", scope: "all" })
      .set("Authorization", `Bearer ${ownerAuth.accessToken}`);
    expect(ownerSearch.status).toBe(200);
    expect(ownerSearch.body.data.projects.length).toBe(1);
    expect(ownerSearch.body.data.tasks.length).toBe(1);
    expect(ownerSearch.body.data.files.length).toBe(1);
    expect(ownerSearch.body.data.clients.length).toBe(1);
    expect(ownerSearch.body.data.projects[0].id).toBe(ownerProjectId);

    const outsiderSearch = await request(app)
      .get("/api/search")
      .query({ q: "scoped", scope: "all" })
      .set("Authorization", `Bearer ${outsiderAuth.accessToken}`);
    expect(outsiderSearch.status).toBe(200);
    expect(outsiderSearch.body.data.projects.length).toBe(1);
    expect(outsiderSearch.body.data.tasks.length).toBe(1);
    expect(outsiderSearch.body.data.files.length).toBe(1);
    expect(outsiderSearch.body.data.clients.length).toBe(1);
    expect(outsiderSearch.body.data.projects[0].id).toBe(outsiderProjectId);

    const ownerProjectsAnalytics = await request(app)
      .get("/api/analytics/projects")
      .set("Authorization", `Bearer ${ownerAuth.accessToken}`);
    expect(ownerProjectsAnalytics.status).toBe(200);
    expect(ownerProjectsAnalytics.body.data.length).toBe(1);
    expect(ownerProjectsAnalytics.body.data[0].projectId).toBe(ownerProjectId);

    const outsiderProjectsAnalytics = await request(app)
      .get("/api/analytics/projects")
      .set("Authorization", `Bearer ${outsiderAuth.accessToken}`);
    expect(outsiderProjectsAnalytics.status).toBe(200);
    expect(outsiderProjectsAnalytics.body.data.length).toBe(1);
    expect(outsiderProjectsAnalytics.body.data[0].projectId).toBe(outsiderProjectId);
  });

  it("tasks: bulk status update and bulk delete", async () => {
    const auth = await login();

    const clientResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ name: "Bulk Client" });
    expect(clientResponse.status).toBe(201);
    const clientId = clientResponse.body.data.id as string;

    const projectResponse = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        clientId,
        name: "Bulk Project",
        startDate: "2026-02-12",
        deadline: "2026-04-01"
      });
    expect(projectResponse.status).toBe(201);
    const projectId = projectResponse.body.data.id as string;

    const t1 = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ projectId, title: "Bulk Task 1", phase: "production" });
    const t2 = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ projectId, title: "Bulk Task 2", phase: "production" });
    const t3 = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ projectId, title: "Bulk Task 3", phase: "production" });

    expect(t1.status).toBe(201);
    expect(t2.status).toBe(201);
    expect(t3.status).toBe(201);

    const taskIds = [t1.body.data.id, t2.body.data.id, t3.body.data.id] as string[];
    const owner = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [adminUser.email]);
    const richTask = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        projectId,
        title: "Rich default-phase task",
        description: "Created with the full task form",
        priority: "high",
        dueDate: "2026-03-20",
        assigneeIds: [owner.rows[0].id],
        labels: [{ name: "Launch", color: "violet" }],
        deliverableRequired: true
      });
    expect(richTask.status).toBe(201);
    expect(richTask.body.data).toMatchObject({
      phase: "client_acquisition",
      priority: "high",
      deliverable_required: true,
      due_date: "2026-03-20"
    });
    expect(richTask.body.data.assignees).toMatchObject([{ id: owner.rows[0].id }]);
    expect(richTask.body.data.labels).toMatchObject([{ name: "Launch", color: "violet" }]);

    const bulkClassification = await request(app)
      .post("/api/tasks/bulk/update")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        taskIds,
        assigneeIds: [owner.rows[0].id],
        phase: "post_production",
        priority: "urgent",
        addLabels: [{ name: "Needs QA", color: "amber" }]
      });
    expect(bulkClassification.status).toBe(200);
    expect(bulkClassification.body.data.updatedCount).toBe(3);
    expect(bulkClassification.body.data.tasks).toHaveLength(3);
    for (const task of bulkClassification.body.data.tasks) {
      expect(task).toMatchObject({ phase: "post_production", priority: "urgent" });
      expect(task.assignees).toMatchObject([{ id: owner.rows[0].id }]);
      expect(task.labels).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Needs QA", color: "amber" })]));
    }

    const bulkToInProgress = await request(app)
      .post("/api/tasks/bulk/status")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        taskIds,
        status: "in_progress",
        reason: "bulk start"
      });

    expect(bulkToInProgress.status).toBe(200);
    expect(bulkToInProgress.body.data.updatedCount).toBe(3);
    expect(bulkToInProgress.body.data.failedCount).toBe(0);

    const bulkToPending = await request(app)
      .post("/api/tasks/bulk/status")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        taskIds,
        status: "pending"
      });

    expect(bulkToPending.status).toBe(200);
    expect(bulkToPending.body.data.updatedCount).toBe(0);
    expect(bulkToPending.body.data.failedCount).toBe(3);

    const bulkDelete = await request(app)
      .post("/api/tasks/bulk/delete")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({ taskIds: [...taskIds, richTask.body.data.id] });

    expect(bulkDelete.status).toBe(200);
    expect(bulkDelete.body.data.deletedCount).toBe(4);

    const listRemaining = await request(app)
      .get(`/api/tasks?projectId=${projectId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(listRemaining.status).toBe(200);
    expect(listRemaining.body.data.length).toBe(0);

    const bulkStatusLogs = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM activity_log
       WHERE action = 'task_status_changed'
         AND details->>'bulk' = 'true'
         AND project_id = $1`,
      [projectId]
    );

    const bulkDeleteLogs = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM activity_log
       WHERE action = 'task_deleted'
         AND details->>'bulk' = 'true'
         AND project_id = $1`,
      [projectId]
    );

    expect(Number(bulkStatusLogs.rows[0].count)).toBe(3);
    expect(Number(bulkDeleteLogs.rows[0].count)).toBe(4);
  });

  it("task deliverables: create, attach, isolate, and complete linked work on submission", async () => {
    const staff = await login();
    const client = await request(app).post("/api/clients")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ name: "Task Deliverable Client" });
    const project = await request(app).post("/api/projects")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ clientId: client.body.data.id, name: "Task Deliverable Project", startDate: "2026-07-01", deadline: "2026-09-01" });

    const createdTask = await request(app).post("/api/tasks")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({
        projectId: project.body.data.id,
        title: "Design launch artwork",
        phase: "production",
        deliverable: { mode: "new", title: "Launch artwork" }
      });
    expect(createdTask.status).toBe(201);
    expect(createdTask.body.data.status).toBe("pending");
    expect(createdTask.body.data.deliverable_required).toBe(true);
    expect(createdTask.body.data.deliverables).toMatchObject([
      { title: "Launch artwork", status: "draft", latest_version_id: null, latest_version_number: null }
    ]);
    const taskId = createdTask.body.data.id as string;
    const linkedDeliverableId = createdTask.body.data.deliverables[0].id as string;

    const standalone = await request(app).post("/api/deliverables")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ projectId: project.body.data.id, title: "Launch copy" });
    expect(standalone.status).toBe(201);
    const attached = await request(app).post(`/api/tasks/${taskId}/deliverables`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ mode: "existing", deliverableId: standalone.body.data.id });
    expect(attached.status).toBe(201);

    const otherClient = await request(app).post("/api/clients")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ name: "Isolated Deliverable Client" });
    const otherProject = await request(app).post("/api/projects")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ clientId: otherClient.body.data.id, name: "Isolated Deliverable Project", startDate: "2026-07-01", deadline: "2026-09-01" });
    const foreignDeliverable = await request(app).post("/api/deliverables")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ projectId: otherProject.body.data.id, title: "Private output" });
    const invalidAttach = await request(app).post(`/api/tasks/${taskId}/deliverables`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ mode: "existing", deliverableId: foreignDeliverable.body.data.id });
    expect(invalidAttach.status).toBe(409);
    const invalidCreate = await request(app).post("/api/tasks")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({
        projectId: project.body.data.id,
        title: "Must roll back",
        phase: "production",
        deliverable: { mode: "existing", deliverableId: foreignDeliverable.body.data.id }
      });
    expect(invalidCreate.status).toBe(409);

    const beforeSubmission = await request(app).get(`/api/tasks/${taskId}`)
      .set("Authorization", `Bearer ${staff.accessToken}`);
    expect(beforeSubmission.status).toBe(200);
    expect(beforeSubmission.body.data.status).toBe("pending");
    expect(beforeSubmission.body.data.deliverables).toHaveLength(2);

    const startedTask = await request(app).patch(`/api/tasks/${taskId}/status`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ status: "in_progress" });
    expect(startedTask.status).toBe(200);
    const manualCompletion = await request(app).patch(`/api/tasks/${taskId}/status`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ status: "completed" });
    expect(manualCompletion.status).toBe(409);
    expect(manualCompletion.body.error).toContain("linked deliverable");

    const upload = await request(app).post("/api/files/upload-binary")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .field("projectId", project.body.data.id)
      .field("fileType", "deliverable")
      .attach("file", Buffer.from("linked task deliverable"), { filename: "launch-artwork.txt", contentType: "text/plain" });
    expect(upload.status).toBe(201);
    const submission = await request(app).post(`/api/deliverables/${linkedDeliverableId}/versions`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ fileId: upload.body.data.id, submissionNote: "Ready for internal approval" });
    expect(submission.status).toBe(201);

    const duplicateWhileReviewActive = await request(app).post(`/api/deliverables/${linkedDeliverableId}/versions`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ fileId: upload.body.data.id, submissionNote: "Must wait for a review decision" });
    expect(duplicateWhileReviewActive.status).toBe(409);

    const referencedFileDeletion = await request(app).delete(`/api/files/${upload.body.data.id}`)
      .set("Authorization", `Bearer ${staff.accessToken}`);
    expect(referencedFileDeletion.status).toBe(409);

    const completedTask = await request(app).get(`/api/tasks/${taskId}`)
      .set("Authorization", `Bearer ${staff.accessToken}`);
    expect(completedTask.status).toBe(200);
    expect(completedTask.body.data.status).toBe("completed");
    expect(completedTask.body.data.completed_at).toBeTruthy();
    expect(completedTask.body.data.deliverables.find((item: { id: string }) => item.id === linkedDeliverableId)).toMatchObject({
      status: "internal_review",
      latest_version_number: 1,
      latest_version_id: submission.body.data.id
    });

    const internalChanges = await request(app).post(`/api/deliverables/versions/${submission.body.data.id}/internal-review`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ decision: "changes_requested", comment: "Please revise before client review." });
    expect(internalChanges.status).toBe(201);
    const reopenedTask = await request(app).get(`/api/tasks/${taskId}`)
      .set("Authorization", `Bearer ${staff.accessToken}`);
    expect(reopenedTask.status).toBe(200);
    expect(reopenedTask.body.data.status).toBe("in_progress");
    expect(reopenedTask.body.data.completed_at).toBeNull();

    const projectTasks = await request(app).get(`/api/tasks?projectId=${project.body.data.id}&page=1&pageSize=100`)
      .set("Authorization", `Bearer ${staff.accessToken}`);
    expect(projectTasks.body.data.some((task: { title: string }) => task.title === "Must roll back")).toBe(false);
  });

  it("client portal: invitation, isolation, deliverable review, and Delivery freeze", async () => {
    const staff = await login();
    const client = await request(app).post("/api/clients")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ name: "Portal Client" });
    const otherClient = await request(app).post("/api/clients")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ name: "Other Client" });
    const project = await request(app).post("/api/projects")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ clientId: client.body.data.id, name: "Portal Campaign", startDate: "2026-07-01", deadline: "2026-09-01" });
    const otherProject = await request(app).post("/api/projects")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ clientId: otherClient.body.data.id, name: "Secret Campaign", startDate: "2026-07-01", deadline: "2026-09-01" });
    const activeClientCannotBeArchived = await request(app).delete(`/api/clients/${client.body.data.id}`)
      .set("Authorization", `Bearer ${staff.accessToken}`);
    expect(activeClientCannotBeArchived.status).toBe(409);

    const manager = await request(app).post("/api/users")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ name: "Project Manager", email: "manager-flow@adfix.local", password: "ManagerPass123!" });
    expect(manager.status).toBe(201);
    const temporaryManagerAuth = await loginAs("manager-flow@adfix.local", "ManagerPass123!");
    const managerPasswordChange = await request(app).post("/api/users/me/change-password")
      .set("Authorization", `Bearer ${temporaryManagerAuth.accessToken}`)
      .send({ currentPassword: "ManagerPass123!", newPassword: "ManagerReady123!" });
    expect(managerPasswordChange.status).toBe(204);
    const managerAuth = await loginAs("manager-flow@adfix.local", "ManagerReady123!");
    const managerMembership = await request(app).post(`/api/projects/${project.body.data.id}/team`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ userId: manager.body.data.id, role: "manager" });
    expect(managerMembership.status).toBe(201);

    const designer = await request(app).post("/api/users")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ name: "Project Designer", email: "designer-flow@adfix.local", password: "DesignerPass123!" });
    expect(designer.status).toBe(201);
    const temporaryDesignerAuth = await loginAs("designer-flow@adfix.local", "DesignerPass123!");
    const designerPasswordChange = await request(app).post("/api/users/me/change-password")
      .set("Authorization", `Bearer ${temporaryDesignerAuth.accessToken}`)
      .send({ currentPassword: "DesignerPass123!", newPassword: "DesignerReady123!" });
    expect(designerPasswordChange.status).toBe(204);
    const designerAuth = await loginAs("designer-flow@adfix.local", "DesignerReady123!");
    const teamMembership = await request(app).post(`/api/projects/${project.body.data.id}/team`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ userId: designer.body.data.id, role: "member" });
    expect(teamMembership.status).toBe(201);
    const sourceTask = await request(app).post("/api/tasks")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({
        projectId: project.body.data.id,
        title: "Produce campaign master",
        phase: "production",
        assigneeIds: [designer.body.data.id]
      });
    expect(sourceTask.status).toBe(201);
    for (const status of ["in_progress", "completed"]) {
      const transition = await request(app).patch(`/api/tasks/${sourceTask.body.data.id}/status`)
        .set("Authorization", `Bearer ${designerAuth.accessToken}`)
        .send({ status });
      expect(transition.status).toBe(200);
    }

    const invitation = await request(app).post("/api/client-invitations")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ clientId: client.body.data.id, email: "reviewer@example.com", role: "reviewer" });
    expect(invitation.status).toBe(201);
    const token = String(invitation.body.data.inviteUrl).split("/invite/")[1];
    const accepted = await request(app).post(`/api/client-invitations/token/${token}/accept`)
      .send({ name: "Client Reviewer", password: "Reviewer123!" });
    expect(accepted.status).toBe(201);
    expect(accepted.body.user.accountType).toBe("client");
    const clientToken = accepted.body.accessToken as string;

    const secondReviewerInvitation = await request(app).post("/api/client-invitations")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ clientId: client.body.data.id, email: "reviewer-two@example.com", role: "reviewer" });
    expect(secondReviewerInvitation.status).toBe(201);
    const secondReviewerToken = String(secondReviewerInvitation.body.data.inviteUrl).split("/invite/")[1];
    const secondReviewerAccepted = await request(app).post(`/api/client-invitations/token/${secondReviewerToken}/accept`)
      .send({ name: "Second Client Reviewer", password: "ReviewerTwo123!" });
    expect(secondReviewerAccepted.status).toBe(201);

    const reused = await request(app).post(`/api/client-invitations/token/${token}/accept`)
      .send({ name: "Client Reviewer", password: "Reviewer123!" });
    expect(reused.status).toBe(404);
    const portalList = await request(app).get("/api/client-portal/projects")
      .set("Authorization", `Bearer ${clientToken}`);
    expect(portalList.status).toBe(200);
    expect(portalList.body.data.map((item: { id: string }) => item.id)).toEqual([project.body.data.id]);
    expect(portalList.body.data[0].client_role).toBe("reviewer");
    const isolated = await request(app).get(`/api/client-portal/projects/${otherProject.body.data.id}`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(isolated.status).toBe(404);
    const internalProjects = await request(app).get("/api/projects")
      .set("Authorization", `Bearer ${clientToken}`);
    expect(internalProjects.status).toBe(403);
    const internalClients = await request(app).get("/api/clients")
      .set("Authorization", `Bearer ${clientToken}`);
    expect(internalClients.status).toBe(403);

    const deliverable = await request(app).post("/api/deliverables")
      .set("Authorization", `Bearer ${designerAuth.accessToken}`)
      .send({ projectId: project.body.data.id, title: "Campaign master", taskIds: [sourceTask.body.data.id] });
    const upload = await request(app).post("/api/files/upload-binary")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .field("projectId", project.body.data.id)
      .field("fileType", "deliverable")
      .attach("file", Buffer.from("local prototype deliverable"), { filename: "campaign.txt", contentType: "text/plain" });
    expect(upload.status).toBe(201);
    expect(upload.body.data.checksum_sha256).toMatch(/^[a-f0-9]{64}$/);
    const versionIdempotencyKey = "campaign-version-one";
    const version = await request(app).post(`/api/deliverables/${deliverable.body.data.id}/versions`)
      .set("Authorization", `Bearer ${designerAuth.accessToken}`)
      .set("Idempotency-Key", versionIdempotencyKey)
      .send({ fileId: upload.body.data.id, submissionNote: "Ready for review" });
    expect(version.status).toBe(201);
    const versionReplay = await request(app).post(`/api/deliverables/${deliverable.body.data.id}/versions`)
      .set("Authorization", `Bearer ${designerAuth.accessToken}`)
      .set("Idempotency-Key", versionIdempotencyKey)
      .send({ fileId: upload.body.data.id, submissionNote: "Ready for review" });
    expect(versionReplay.status).toBe(201);
    expect(versionReplay.body.data.id).toBe(version.body.data.id);
    const versionKeyConflict = await request(app).post(`/api/deliverables/${deliverable.body.data.id}/versions`)
      .set("Authorization", `Bearer ${designerAuth.accessToken}`)
      .set("Idempotency-Key", versionIdempotencyKey)
      .send({ fileId: upload.body.data.id, submissionNote: "A different request" });
    expect(versionKeyConflict.status).toBe(409);
    expect(versionKeyConflict.body.code).toBe("IDEMPOTENCY_KEY_REUSED");
    const versionCount = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM deliverable_versions WHERE deliverable_id = $1",
      [deliverable.body.data.id]
    );
    expect(versionCount.rows[0].count).toBe("1");
    expect(await notificationRecipientEmails("deliverable_internal_review_requested", version.body.data.id)).toEqual([
      adminUser.email,
      "manager-flow@adfix.local"
    ]);

    const hiddenDuringInternalReview = await request(app).get(`/api/client-portal/projects/${project.body.data.id}`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(hiddenDuringInternalReview.status).toBe(200);
    expect(hiddenDuringInternalReview.body.data.deliverables).toHaveLength(0);
    const hiddenFileDownload = await request(app).get(`/api/files/${upload.body.data.id}/content`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(hiddenFileDownload.status).toBe(403);
    const hiddenPreviewSession = await request(app).post(`/api/files/${upload.body.data.id}/preview-session`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(hiddenPreviewSession.status).toBe(403);

    const designerCannotApprove = await request(app).post(`/api/deliverables/versions/${version.body.data.id}/internal-review`)
      .set("Authorization", `Bearer ${designerAuth.accessToken}`)
      .send({ decision: "approved" });
    expect(designerCannotApprove.status).toBe(403);
    const supervisorNotifications = await request(app).get("/api/notifications?unreadOnly=true&page=1&pageSize=50")
      .set("Authorization", `Bearer ${staff.accessToken}`);
    expect(supervisorNotifications.status).toBe(200);
    expect(supervisorNotifications.body.data.some((item: { type: string }) => item.type === "deliverable_internal_review_requested")).toBe(true);

    const internalReviewIdempotencyKey = "campaign-internal-approval";
    const internalApproval = await request(app).post(`/api/deliverables/versions/${version.body.data.id}/internal-review`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .set("Idempotency-Key", internalReviewIdempotencyKey)
      .send({ decision: "approved", comment: "Approved for client presentation" });
    expect(internalApproval.status).toBe(201);
    const internalApprovalReplay = await request(app).post(`/api/deliverables/versions/${version.body.data.id}/internal-review`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .set("Idempotency-Key", internalReviewIdempotencyKey)
      .send({ decision: "approved", comment: "Approved for client presentation" });
    expect(internalApprovalReplay.status).toBe(201);
    expect(internalApprovalReplay.body.data.id).toBe(internalApproval.body.data.id);
    const internalReviewCount = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM deliverable_internal_reviews WHERE deliverable_version_id = $1",
      [version.body.data.id]
    );
    expect(internalReviewCount.rows[0].count).toBe("1");
    expect(await notificationRecipientEmails("deliverable_internal_approved", version.body.data.id)).toEqual([
      "designer-flow@adfix.local",
      "manager-flow@adfix.local"
    ]);
    const readyToSubmitNotification = await request(app)
      .get("/api/notifications?actionStatus=open&pageSize=50")
      .set("Authorization", `Bearer ${staff.accessToken}`);
    expect(readyToSubmitNotification.status).toBe(200);
    expect(readyToSubmitNotification.body.data.some((item: { type: string }) =>
      item.type === "deliverable_client_submission_ready"
    )).toBe(true);
    const hiddenAfterInternalApproval = await request(app).get(`/api/client-portal/projects/${project.body.data.id}`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(hiddenAfterInternalApproval.status).toBe(200);
    expect(hiddenAfterInternalApproval.body.data.deliverables).toHaveLength(0);
    const designerCannotSubmitToClient = await request(app).post(`/api/deliverables/versions/${version.body.data.id}/submit-client`)
      .set("Authorization", `Bearer ${designerAuth.accessToken}`);
    expect(designerCannotSubmitToClient.status).toBe(403);
    const clientSubmissionIdempotencyKey = "campaign-client-submission-one";
    const clientSubmission = await request(app).post(`/api/deliverables/versions/${version.body.data.id}/submit-client`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .set("Idempotency-Key", clientSubmissionIdempotencyKey);
    expect(clientSubmission.status).toBe(200);
    const clientSubmissionReplay = await request(app).post(`/api/deliverables/versions/${version.body.data.id}/submit-client`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .set("Idempotency-Key", clientSubmissionIdempotencyKey);
    expect(clientSubmissionReplay.status).toBe(200);
    const resolvedSubmitNotification = await request(app)
      .get("/api/notifications?actionStatus=resolved&pageSize=50")
      .set("Authorization", `Bearer ${staff.accessToken}`);
    expect(resolvedSubmitNotification.status).toBe(200);
    expect(resolvedSubmitNotification.body.data.some((item: { type: string }) =>
      item.type === "deliverable_client_submission_ready"
    )).toBe(true);
    const clientOwnershipLocked = await request(app).put(`/api/projects/${project.body.data.id}`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ clientId: otherClient.body.data.id });
    expect(clientOwnershipLocked.status).toBe(409);
    expect(await notificationRecipientEmails("deliverable_client_review_requested", version.body.data.id)).toEqual([
      "reviewer-two@example.com",
      "reviewer@example.com"
    ]);
    expect(await notificationRecipientEmails("deliverable_client_review_started", version.body.data.id)).toEqual([
      "designer-flow@adfix.local",
      "manager-flow@adfix.local"
    ]);
    const visibleAfterSupervisorSubmission = await request(app).get(`/api/client-portal/projects/${project.body.data.id}`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(visibleAfterSupervisorSubmission.status).toBe(200);
    expect(visibleAfterSupervisorSubmission.body.data.deliverables).toHaveLength(1);

    const previewSession = await request(app).post(`/api/files/${upload.body.data.id}/preview-session`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(previewSession.status).toBe(200);
    expect(previewSession.body.data).toMatchObject({
      path: `/files/${upload.body.data.id}/preview`,
      fileName: "campaign.txt",
      mimeType: "text/plain",
      kind: "text",
      expiresInSeconds: 300
    });
    const previewCookie = (previewSession.headers["set-cookie"] as unknown as string[])[0].split(";")[0];
    const previewWithoutSession = await request(app).get(`/api/files/${upload.body.data.id}/preview`);
    expect(previewWithoutSession.status).toBe(401);
    const previewRange = await request(app).get(`/api/files/${upload.body.data.id}/preview`)
      .set("Cookie", previewCookie)
      .set("Range", "bytes=0-4");
    expect(previewRange.status).toBe(206);
    expect(previewRange.headers["accept-ranges"]).toBe("bytes");
    expect(previewRange.headers["content-range"]).toBe("bytes 0-4/27");
    expect(previewRange.headers["content-disposition"]).toContain("inline");
    expect(previewRange.text).toBe("local");

    const differentSupervisorCannotWithdraw = await request(app).post(`/api/deliverables/versions/${version.body.data.id}/withdraw-client`)
      .set("Authorization", `Bearer ${managerAuth.accessToken}`);
    expect(differentSupervisorCannotWithdraw.status).toBe(403);

    const withdrawalIdempotencyKey = "campaign-client-withdrawal";
    const withdrawal = await request(app).post(`/api/deliverables/versions/${version.body.data.id}/withdraw-client`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .set("Idempotency-Key", withdrawalIdempotencyKey);
    expect(withdrawal.status).toBe(200);
    const withdrawalReplay = await request(app).post(`/api/deliverables/versions/${version.body.data.id}/withdraw-client`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .set("Idempotency-Key", withdrawalIdempotencyKey);
    expect(withdrawalReplay.status).toBe(200);
    expect(await notificationRecipientEmails("deliverable_client_review_withdrawn", version.body.data.id)).toEqual([
      "reviewer-two@example.com",
      "reviewer@example.com"
    ]);
    expect(await notificationRecipientEmails("deliverable_client_review_withdrawn_internal", version.body.data.id)).toEqual([
      "designer-flow@adfix.local",
      "manager-flow@adfix.local"
    ]);
    const hiddenAfterWithdrawal = await request(app).get(`/api/client-portal/projects/${project.body.data.id}`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(hiddenAfterWithdrawal.status).toBe(200);
    expect(hiddenAfterWithdrawal.body.data.deliverables).toHaveLength(0);
    const withdrawnFileDownload = await request(app).get(`/api/files/${upload.body.data.id}/content`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(withdrawnFileDownload.status).toBe(403);
    const withdrawnPreviewSession = await request(app).post(`/api/files/${upload.body.data.id}/preview-session`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(withdrawnPreviewSession.status).toBe(403);
    const withdrawnPreviewStream = await request(app).get(`/api/files/${upload.body.data.id}/preview`)
      .set("Cookie", previewCookie);
    expect(withdrawnPreviewStream.status).toBe(403);
    const clientNotificationsAfterWithdrawal = await request(app).get("/api/notifications?unreadOnly=true&page=1&pageSize=50")
      .set("Authorization", `Bearer ${clientToken}`);
    expect(clientNotificationsAfterWithdrawal.status).toBe(200);
    expect(clientNotificationsAfterWithdrawal.body.data.some((item: { type: string }) => item.type === "deliverable_client_review_requested")).toBe(false);
    expect(clientNotificationsAfterWithdrawal.body.data.some((item: { type: string }) => item.type === "deliverable_client_review_withdrawn")).toBe(true);

    const resubmission = await request(app).post(`/api/deliverables/versions/${version.body.data.id}/submit-client`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .set("Idempotency-Key", "campaign-client-resubmission");
    expect(resubmission.status).toBe(200);
    const visibleAfterResubmission = await request(app).get(`/api/client-portal/projects/${project.body.data.id}`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(visibleAfterResubmission.status).toBe(200);
    expect(visibleAfterResubmission.body.data.deliverables).toHaveLength(1);

    const viewerInvitation = await request(app).post("/api/client-invitations")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ clientId: client.body.data.id, email: "viewer@example.com", role: "viewer" });
    expect(viewerInvitation.status).toBe(201);
    const viewerToken = String(viewerInvitation.body.data.inviteUrl).split("/invite/")[1];
    const viewerAccepted = await request(app).post(`/api/client-invitations/token/${viewerToken}/accept`)
      .send({ name: "Client Viewer", password: "ViewerPass123!" });
    expect(viewerAccepted.status).toBe(201);
    const viewerAccessToken = viewerAccepted.body.accessToken as string;

    const clientAccessList = await request(app).get("/api/client-invitations")
      .set("Authorization", `Bearer ${staff.accessToken}`);
    expect(clientAccessList.status).toBe(200);
    expect(clientAccessList.body.data.filter((item: { status: string }) => item.status === "active").length).toBe(3);

    const viewerProject = await request(app).get(`/api/client-portal/projects/${project.body.data.id}`)
      .set("Authorization", `Bearer ${viewerAccessToken}`);
    expect(viewerProject.status).toBe(200);
    expect(viewerProject.body.data.client_role).toBe("viewer");

    const viewerReview = await request(app).post(`/api/client-portal/versions/${version.body.data.id}/reviews`)
      .set("Authorization", `Bearer ${viewerAccessToken}`)
      .send({ decision: "approved" });
    expect(viewerReview.status).toBe(403);

    const missingComment = await request(app).post(`/api/client-portal/versions/${version.body.data.id}/reviews`)
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ decision: "changes_requested" });
    expect(missingComment.status).toBe(400);
    const clientReviewIdempotencyKey = "campaign-client-change-request";
    const changeRequest = await request(app).post(`/api/client-portal/versions/${version.body.data.id}/reviews`)
      .set("Authorization", `Bearer ${clientToken}`)
      .set("Idempotency-Key", clientReviewIdempotencyKey)
      .send({ decision: "changes_requested", comment: "Please make the logo larger and reduce the opening copy." });
    expect(changeRequest.status).toBe(201);
    const changeRequestReplay = await request(app).post(`/api/client-portal/versions/${version.body.data.id}/reviews`)
      .set("Authorization", `Bearer ${clientToken}`)
      .set("Idempotency-Key", clientReviewIdempotencyKey)
      .send({ decision: "changes_requested", comment: "Please make the logo larger and reduce the opening copy." });
    expect(changeRequestReplay.status).toBe(201);
    expect(changeRequestReplay.body.data.id).toBe(changeRequest.body.data.id);
    const reviewCount = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM deliverable_reviews WHERE deliverable_version_id = $1",
      [version.body.data.id]
    );
    expect(reviewCount.rows[0].count).toBe("1");
    expect(await notificationRecipientEmails("deliverable_changes_requested", version.body.data.id)).toEqual([
      adminUser.email,
      "manager-flow@adfix.local"
    ]);
    expect(await notificationRecipientEmails("deliverable_client_feedback_received", version.body.data.id)).toEqual([
      "designer-flow@adfix.local"
    ]);
    expect(await notificationRecipientEmails("deliverable_client_review_completed", version.body.data.id)).toEqual([
      "reviewer-two@example.com"
    ]);

    const clientMessageIdempotencyKey = "campaign-client-message";
    const clientMessage = await request(app).post(`/api/client-portal/versions/${version.body.data.id}/messages`)
      .set("Authorization", `Bearer ${clientToken}`)
      .set("Idempotency-Key", clientMessageIdempotencyKey)
      .send({ body: "The logo change is the priority for our launch team." });
    expect(clientMessage.status).toBe(201);
    const clientMessageReplay = await request(app).post(`/api/client-portal/versions/${version.body.data.id}/messages`)
      .set("Authorization", `Bearer ${clientToken}`)
      .set("Idempotency-Key", clientMessageIdempotencyKey)
      .send({ body: "The logo change is the priority for our launch team." });
    expect(clientMessageReplay.status).toBe(201);
    expect(clientMessageReplay.body.data.id).toBe(clientMessage.body.data.id);

    const supervisorView = await request(app).get(`/api/deliverables/project/${project.body.data.id}`)
      .set("Authorization", `Bearer ${staff.accessToken}`);
    expect(supervisorView.status).toBe(200);
    expect(supervisorView.body.data[0].versions[0].reviews[0].comment).toContain("logo larger");
    expect(supervisorView.body.data[0].versions[0].messages[0].body).toContain("priority");

    const designerView = await request(app).get(`/api/deliverables/project/${project.body.data.id}`)
      .set("Authorization", `Bearer ${designerAuth.accessToken}`);
    expect(designerView.status).toBe(200);
    expect(designerView.body.data[0].versions[0].reviews).toHaveLength(0);
    expect(designerView.body.data[0].versions[0].messages).toHaveLength(0);

    const revisionUpload = await request(app).post("/api/files/upload-binary")
      .set("Authorization", `Bearer ${designerAuth.accessToken}`)
      .field("projectId", project.body.data.id)
      .field("fileType", "deliverable")
      .attach("file", Buffer.from("revised local prototype deliverable"), { filename: "campaign-v2.txt", contentType: "text/plain" });
    expect(revisionUpload.status).toBe(201);
    const revisionBeforeRouting = await request(app).post(`/api/deliverables/${deliverable.body.data.id}/versions`)
      .set("Authorization", `Bearer ${designerAuth.accessToken}`)
      .send({ fileId: revisionUpload.body.data.id, submissionNote: "Revision attempt before routing" });
    expect(revisionBeforeRouting.status).toBe(409);

    const staffReply = await request(app).post(`/api/deliverables/versions/${version.body.data.id}/messages`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ body: "Thanks. We have prioritized the logo adjustment." });
    expect(staffReply.status).toBe(201);
    const routed = await request(app).post(`/api/deliverables/versions/${version.body.data.id}/forward-feedback`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({
        sourceReviewId: changeRequest.body.data.id,
        taskIds: [sourceTask.body.data.id],
        body: "Increase the logo size and shorten the opening copy before uploading version 2."
      });
    expect(routed.status).toBe(201);

    const reopenedAfterClientFeedback = await request(app).get(`/api/tasks/${sourceTask.body.data.id}`)
      .set("Authorization", `Bearer ${designerAuth.accessToken}`);
    expect(reopenedAfterClientFeedback.status).toBe(200);
    expect(reopenedAfterClientFeedback.body.data.status).toBe("in_progress");
    expect(reopenedAfterClientFeedback.body.data.completed_at).toBeNull();

    const designerNotifications = await request(app).get("/api/notifications?unreadOnly=true&page=1&pageSize=50")
      .set("Authorization", `Bearer ${designerAuth.accessToken}`);
    expect(designerNotifications.status).toBe(200);
    expect(designerNotifications.body.data.some((item: { type: string }) => item.type === "client_feedback_forwarded")).toBe(true);
    const taskComments = await request(app).get(`/api/tasks/${sourceTask.body.data.id}/comments?page=1&pageSize=50`)
      .set("Authorization", `Bearer ${designerAuth.accessToken}`);
    expect(taskComments.status).toBe(200);
    expect(taskComments.body.data.some((item: { body: string }) => item.body.includes("Increase the logo size"))).toBe(true);

    const versionTwo = await request(app).post(`/api/deliverables/${deliverable.body.data.id}/versions`)
      .set("Authorization", `Bearer ${designerAuth.accessToken}`)
      .send({ fileId: revisionUpload.body.data.id, submissionNote: "Logo and opening copy updated" });
    expect(versionTwo.status).toBe(201);
    const internalApprovalTwo = await request(app).post(`/api/deliverables/versions/${versionTwo.body.data.id}/internal-review`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ decision: "approved" });
    expect(internalApprovalTwo.status).toBe(201);
    const clientSubmissionTwo = await request(app).post(`/api/deliverables/versions/${versionTwo.body.data.id}/submit-client`)
      .set("Authorization", `Bearer ${staff.accessToken}`);
    expect(clientSubmissionTwo.status).toBe(200);
    const approval = await request(app).post(`/api/client-portal/versions/${versionTwo.body.data.id}/reviews`)
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ decision: "approved", comment: "Approved for launch." });
    expect(approval.status).toBe(201);
    expect(await notificationRecipientEmails("deliverable_approved", versionTwo.body.data.id)).toEqual([
      adminUser.email,
      "manager-flow@adfix.local"
    ]);
    expect(await notificationRecipientEmails("deliverable_client_approved", versionTwo.body.data.id)).toEqual([
      "designer-flow@adfix.local"
    ]);
    expect(await notificationRecipientEmails("deliverable_client_review_completed", versionTwo.body.data.id)).toEqual([
      "reviewer-two@example.com"
    ]);

    const fullStaffHistory = await request(app).get(`/api/deliverables/project/${project.body.data.id}`)
      .set("Authorization", `Bearer ${staff.accessToken}`);
    expect(fullStaffHistory.status).toBe(200);
    const historyDeliverable = fullStaffHistory.body.data.find((item: { id: string }) => item.id === deliverable.body.data.id);
    expect(historyDeliverable.versions).toHaveLength(2);
    const versionOneHistory = historyDeliverable.versions.find((item: { id: string }) => item.id === version.body.data.id);
    const versionTwoHistory = historyDeliverable.versions.find((item: { id: string }) => item.id === versionTwo.body.data.id);
    expect(versionOneHistory).toMatchObject({
      version_number: 1,
      submission_note: "Ready for review",
      submitted_by_name: "Project Designer",
      client_submitted_by_name: "Adfix Admin",
      client_withdrawn_by_name: "Adfix Admin"
    });
    expect(versionOneHistory.client_submitted_at).toBeTruthy();
    expect(versionOneHistory.client_withdrawn_at).toBeTruthy();
    expect(versionOneHistory.internal_reviews).toEqual(expect.arrayContaining([
      expect.objectContaining({ reviewer_name: "Adfix Admin", decision: "approved", comment: "Approved for client presentation" })
    ]));
    expect(versionOneHistory.reviews).toEqual(expect.arrayContaining([
      expect.objectContaining({ reviewer_name: "Client Reviewer", decision: "changes_requested" })
    ]));
    expect(versionOneHistory.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ author_name: "Client Reviewer", author_type: "client" }),
      expect.objectContaining({ author_name: "Adfix Admin", author_type: "staff" })
    ]));
    expect(versionTwoHistory).toMatchObject({
      version_number: 2,
      submission_note: "Logo and opening copy updated",
      submitted_by_name: "Project Designer",
      client_submitted_by_name: "Adfix Admin",
      client_withdrawn_by_name: null
    });
    expect(versionTwoHistory.internal_reviews).toEqual(expect.arrayContaining([
      expect.objectContaining({ reviewer_name: "Adfix Admin", decision: "approved" })
    ]));
    expect(versionTwoHistory.reviews).toEqual(expect.arrayContaining([
      expect.objectContaining({ reviewer_name: "Client Reviewer", decision: "approved", comment: "Approved for launch." })
    ]));

    for (const phase of ["strategy_planning", "production", "post_production", "delivery"]) {
      const transition = await request(app).patch(`/api/projects/${project.body.data.id}/phase`)
        .set("Authorization", `Bearer ${staff.accessToken}`)
        .send({ phase, confirmUnresolvedReviews: phase === "delivery" });
      expect(transition.status).toBe(200);
    }
    const frozen = await request(app).post(`/api/client-portal/versions/${versionTwo.body.data.id}/reviews`)
      .set("Authorization", `Bearer ${clientToken}`)
      .send({ decision: "changes_requested", comment: "Too late" });
    expect(frozen.status).toBe(409);

    const downloaded = await request(app).get(`/api/files/${revisionUpload.body.data.id}/content`)
      .set("Authorization", `Bearer ${clientToken}`);
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers["content-disposition"]).toContain("campaign-v2.txt");

    const unresolvedTask = await request(app).post("/api/tasks")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ projectId: otherProject.body.data.id, title: "Prepare private draft", phase: "production" });
    expect(unresolvedTask.status).toBe(201);
    const unresolvedDeliverable = await request(app).post("/api/deliverables")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({
        projectId: otherProject.body.data.id,
        title: "Unresolved campaign draft",
        taskIds: [unresolvedTask.body.data.id]
      });
    expect(unresolvedDeliverable.status).toBe(201);
    const unresolvedUpload = await request(app).post("/api/files/upload-binary")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .field("projectId", otherProject.body.data.id)
      .field("fileType", "deliverable")
      .attach("file", Buffer.from("unresolved client draft"), { filename: "unresolved.txt", contentType: "text/plain" });
    expect(unresolvedUpload.status).toBe(201);
    const unresolvedVersion = await request(app).post(`/api/deliverables/${unresolvedDeliverable.body.data.id}/versions`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ fileId: unresolvedUpload.body.data.id, submissionNote: "Still awaiting internal approval" });
    expect(unresolvedVersion.status).toBe(201);
    const ordinaryDeliveryFile = await request(app).post("/api/files/upload-binary")
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .field("projectId", otherProject.body.data.id)
      .field("fileType", "asset")
      .attach("file", Buffer.from("delivery archive asset"), { filename: "archive.txt", contentType: "text/plain" });
    expect(ordinaryDeliveryFile.status).toBe(201);

    for (const phase of ["strategy_planning", "production", "post_production"]) {
      const transition = await request(app).patch(`/api/projects/${otherProject.body.data.id}/phase`)
        .set("Authorization", `Bearer ${staff.accessToken}`)
        .send({ phase });
      expect(transition.status).toBe(200);
    }
    const unconfirmedDelivery = await request(app).patch(`/api/projects/${otherProject.body.data.id}/phase`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({ phase: "delivery", reason: "Internal launch exception" });
    expect(unconfirmedDelivery.status).toBe(409);
    expect(unconfirmedDelivery.body.code).toBe("DELIVERY_CONFIRMATION_REQUIRED");
    expect(unconfirmedDelivery.body.details.unresolvedReviews).toBe(1);
    expect(unconfirmedDelivery.body.details.incompleteTasks).toBeGreaterThan(0);

    const confirmedDelivery = await request(app).patch(`/api/projects/${otherProject.body.data.id}/phase`)
      .set("Authorization", `Bearer ${staff.accessToken}`)
      .send({
        phase: "delivery",
        reason: "Internal launch exception",
        clientUpdate: "The final package has entered Delivery.",
        confirmUnresolvedReviews: true
      });
    expect(confirmedDelivery.status).toBe(200);
    expect(confirmedDelivery.body.meta.warnings.unresolvedReviews).toBe(1);
    expect(confirmedDelivery.body.meta.warnings.incompleteTasks).toBeGreaterThan(0);

    const deliveryActivity = await pool.query<{
      action: string;
      client_visible: boolean;
      reason: string | null;
      update: string | null;
    }>(
      `SELECT action, client_visible, details->>'reason' AS reason, details->>'update' AS update
       FROM activity_log
       WHERE project_id = $1
         AND details->>'to' = 'delivery'
         AND action IN ('project_phase_changed', 'project_milestone_shared')
       ORDER BY client_visible ASC`,
      [otherProject.body.data.id]
    );
    expect(deliveryActivity.rows).toEqual([
      expect.objectContaining({
        action: "project_phase_changed",
        client_visible: false,
        reason: "Internal launch exception",
        update: null
      }),
      expect.objectContaining({
        action: "project_milestone_shared",
        client_visible: true,
        reason: null,
        update: "The final package has entered Delivery."
      })
    ]);

    const deliveryFileDeletion = await request(app).delete(`/api/files/${ordinaryDeliveryFile.body.data.id}`)
      .set("Authorization", `Bearer ${staff.accessToken}`);
    expect(deliveryFileDeletion.status).toBe(409);
    const deliveryProjectDeletion = await request(app).delete(`/api/projects/${otherProject.body.data.id}`)
      .set("Authorization", `Bearer ${staff.accessToken}`);
    expect(deliveryProjectDeletion.status).toBe(409);
  });

  it("client access: existing accounts accept safely and administrators can change or revoke access", async () => {
    const adminAuth = await login();
    const clientResponse = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${adminAuth.accessToken}`)
      .send({ name: "Existing Account Client" });
    expect(clientResponse.status).toBe(201);
    const clientId = clientResponse.body.data.id as string;

    const password = "ExistingClient123!";
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users (email, name, password_hash, is_active, is_admin, account_type, created_at, updated_at)
       VALUES ('existing-client@adfix.local', 'Existing Client', $1, TRUE, FALSE, 'client', NOW(), NOW()),
              ('wrong-client@adfix.local', 'Wrong Client', $1, TRUE, FALSE, 'client', NOW(), NOW())`,
      [passwordHash]
    );

    const invitation = await request(app)
      .post("/api/client-invitations")
      .set("Authorization", `Bearer ${adminAuth.accessToken}`)
      .send({ clientId, email: "existing-client@adfix.local", role: "reviewer" });
    expect(invitation.status).toBe(201);
    const token = String(invitation.body.data.inviteUrl).split("/invite/")[1];

    const duplicateInvitation = await request(app)
      .post("/api/client-invitations")
      .set("Authorization", `Bearer ${adminAuth.accessToken}`)
      .send({ clientId, email: "existing-client@adfix.local", role: "reviewer" });
    expect(duplicateInvitation.status).toBe(409);

    const inspection = await request(app).get(`/api/client-invitations/token/${token}`);
    expect(inspection.status).toBe(200);
    expect(inspection.body.data.accountExists).toBe(true);

    const wrongAccountAuth = await loginAs("wrong-client@adfix.local", password);
    const mismatch = await request(app)
      .post(`/api/client-invitations/token/${token}/accept-existing`)
      .set("Authorization", `Bearer ${wrongAccountAuth.accessToken}`);
    expect(mismatch.status).toBe(403);

    const clientAuth = await loginAs("existing-client@adfix.local", password);
    const accepted = await request(app)
      .post(`/api/client-invitations/token/${token}/accept-existing`)
      .set("Authorization", `Bearer ${clientAuth.accessToken}`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.role).toBe("reviewer");

    const accessList = await request(app)
      .get("/api/client-invitations")
      .set("Authorization", `Bearer ${adminAuth.accessToken}`);
    const membership = accessList.body.data.find((record: { email: string; kind: string }) =>
      record.kind === "membership" && record.email === "existing-client@adfix.local"
    );
    expect(membership).toBeTruthy();

    const roleUpdate = await request(app)
      .patch(`/api/client-invitations/memberships/${clientId}/${membership.id}`)
      .set("Authorization", `Bearer ${adminAuth.accessToken}`)
      .send({ role: "viewer" });
    expect(roleUpdate.status).toBe(200);
    expect(roleUpdate.body.data.role).toBe("viewer");

    const removal = await request(app)
      .delete(`/api/client-invitations/memberships/${clientId}/${membership.id}`)
      .set("Authorization", `Bearer ${adminAuth.accessToken}`);
    expect(removal.status).toBe(204);

    const clientNotifications = await request(app)
      .get("/api/notifications?pageSize=20")
      .set("Authorization", `Bearer ${clientAuth.accessToken}`);
    expect(clientNotifications.status).toBe(200);
    expect(clientNotifications.body.data.map((item: { type: string }) => item.type)).toEqual(
      expect.arrayContaining(["client_access_role_changed", "client_access_revoked"])
    );

    const auditEvents = await pool.query<{ action: string }>(
      `SELECT action FROM activity_log
       WHERE action IN (
         'client_invitation_created', 'client_invitation_accepted',
         'client_access_role_changed', 'client_access_revoked'
       )`
    );
    expect(auditEvents.rows.map((row) => row.action)).toEqual(expect.arrayContaining([
      "client_invitation_created",
      "client_invitation_accepted",
      "client_access_role_changed",
      "client_access_revoked"
    ]));
  });

  it("notifications: durable events deduplicate and action lifecycle remains separate from read state", async () => {
    const adminAuth = await login();
    const admin = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [adminUser.email]);
    const versionId = "11111111-1111-4111-8111-111111111111";
    const eventKey = `test:${versionId}:internal-review`;
    const notification = {
      type: "deliverable_internal_review_requested",
      title: "Approval requested",
      message: "A version needs internal approval.",
      metadata: { versionId, href: "/notifications" }
    };
    await createNotificationsForUsers([admin.rows[0].id], notification, { eventKey });
    await createNotificationsForUsers([admin.rows[0].id], notification, { eventKey });

    const beforeResolution = await request(app)
      .get("/api/notifications?actionStatus=open")
      .set("Authorization", `Bearer ${adminAuth.accessToken}`);
    expect(beforeResolution.status).toBe(200);
    expect(beforeResolution.body.data).toHaveLength(1);
    expect(beforeResolution.body.data[0].action_required).toBe(true);
    expect(beforeResolution.body.meta.openActionCount).toBe(1);

    await resolveActionNotificationsForVersion(
      versionId,
      ["deliverable_internal_review_requested"],
      "internal_approved"
    );

    const afterResolution = await request(app)
      .get("/api/notifications?actionStatus=resolved")
      .set("Authorization", `Bearer ${adminAuth.accessToken}`);
    expect(afterResolution.status).toBe(200);
    expect(afterResolution.body.data).toHaveLength(1);
    expect(afterResolution.body.data[0].is_read).toBe(false);
    expect(afterResolution.body.data[0].action_status).toBe("resolved");
    expect(afterResolution.body.meta.openActionCount).toBe(0);

    const outbox = await pool.query<{ status: string; attempts: number }>(
      "SELECT status, attempts FROM notification_outbox WHERE event_key = $1",
      [eventKey]
    );
    expect(outbox.rows).toEqual([{ status: "completed", attempts: 1 }]);
  });

  it("dashboard: supervisors receive decision queues, delivery risks, client waits, and team workload", async () => {
    const adminAuth = await login();
    const admin = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [adminUser.email]);
    const client = await pool.query<{ id: string }>(
      `INSERT INTO clients (name) VALUES ('Dashboard Client') RETURNING id`
    );
    const project = await pool.query<{ id: string }>(
      `INSERT INTO projects (client_id, name, current_phase, priority, start_date, deadline, created_by)
       VALUES ($1, 'Supervisor Campaign', 'production', 'high', CURRENT_DATE, CURRENT_DATE + 30, $2)
       RETURNING id`,
      [client.rows[0].id, admin.rows[0].id]
    );
    const dueTask = await pool.query<{ id: string }>(
      `INSERT INTO tasks (project_id, title, phase, status, priority, due_date, created_by)
       VALUES ($1, 'Export today', 'production', 'in_progress', 'high', CURRENT_DATE, $2)
       RETURNING id`,
      [project.rows[0].id, admin.rows[0].id]
    );
    const blockedTask = await pool.query<{ id: string }>(
      `INSERT INTO tasks (project_id, title, phase, status, priority, created_by)
       VALUES ($1, 'Blocked voiceover', 'production', 'blocked', 'urgent', $2)
       RETURNING id`,
      [project.rows[0].id, admin.rows[0].id]
    );
    await pool.query(
      `INSERT INTO task_assignees (task_id, user_id, assigned_by)
       VALUES ($1, $3, $3), ($2, $3, $3)`,
      [dueTask.rows[0].id, blockedTask.rows[0].id, admin.rows[0].id]
    );
    const file = await pool.query<{ id: string }>(
      `INSERT INTO files (project_id, file_name, file_type, storage_type, object_key, mime_type, file_size, uploaded_by)
       VALUES ($1, 'review.pdf', 'deliverable', 'local', 'dashboard-review.pdf', 'application/pdf', 100, $2)
       RETURNING id`,
      [project.rows[0].id, admin.rows[0].id]
    );
    const internalDeliverable = await pool.query<{ id: string }>(
      `INSERT INTO deliverables (project_id, title, status, created_by)
       VALUES ($1, 'Internal decision', 'internal_review', $2) RETURNING id`,
      [project.rows[0].id, admin.rows[0].id]
    );
    const internalVersion = await pool.query<{ id: string }>(
      `INSERT INTO deliverable_versions (deliverable_id, file_id, version_number, submitted_by)
       VALUES ($1, $2, 1, $3) RETURNING id`,
      [internalDeliverable.rows[0].id, file.rows[0].id, admin.rows[0].id]
    );
    const clientDeliverable = await pool.query<{ id: string }>(
      `INSERT INTO deliverables (project_id, title, status, created_by)
       VALUES ($1, 'Waiting for client', 'in_review', $2) RETURNING id`,
      [project.rows[0].id, admin.rows[0].id]
    );
    const clientVersion = await pool.query<{ id: string }>(
      `INSERT INTO deliverable_versions (
         deliverable_id, file_id, version_number, submitted_by, client_submitted_by, client_submitted_at
       ) VALUES ($1, $2, 1, $3, $3, NOW()) RETURNING id`,
      [clientDeliverable.rows[0].id, file.rows[0].id, admin.rows[0].id]
    );
    await pool.query(
      `INSERT INTO notifications (
         user_id, project_id, type, title, message, metadata, action_required, action_status
       ) VALUES ($1, $2, 'deliverable_client_message', 'Client replied', 'Please adjust the final frame.', $3::jsonb, TRUE, 'open')`,
      [admin.rows[0].id, project.rows[0].id, JSON.stringify({
        deliverableId: clientDeliverable.rows[0].id,
        versionId: clientVersion.rows[0].id
      })]
    );

    const response = await request(app)
      .get("/api/analytics/dashboard")
      .set("Authorization", `Bearer ${adminAuth.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.internalReviewsAwaitingDecision).toEqual([
      expect.objectContaining({ versionId: internalVersion.rows[0].id, deliverableTitle: "Internal decision" })
    ]);
    expect(response.body.data.clientFeedbackAwaitingResponse).toEqual([
      expect.objectContaining({ message: "Please adjust the final frame." })
    ]);
    expect(response.body.data.dueTodayAssignments).toEqual([
      expect.objectContaining({ id: dueTask.rows[0].id, title: "Export today" })
    ]);
    expect(response.body.data.blockedTasks).toEqual([
      expect.objectContaining({ id: blockedTask.rows[0].id, title: "Blocked voiceover" })
    ]);
    expect(response.body.data.unresolvedClientReviews).toEqual([
      expect.objectContaining({ versionId: clientVersion.rows[0].id, deliverableTitle: "Waiting for client" })
    ]);
    expect(response.body.data.workload).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: admin.rows[0].id, activeTasks: 2, dueToday: 1, blockedTasks: 1 })
    ]));
  });

  it("client review inbox: isolates memberships and separates pending, reviewed, and history", async () => {
    const password = "ClientInbox123!";
    const passwordHash = await bcrypt.hash(password, 12);
    const users = await pool.query<{ id: string; email: string }>(
      `INSERT INTO users (email, name, password_hash, is_active, is_admin, account_type)
       VALUES
         ('inbox-a@adfix.local', 'Inbox A', $1, TRUE, FALSE, 'client'),
         ('inbox-b@adfix.local', 'Inbox B', $1, TRUE, FALSE, 'client')
       RETURNING id, email`,
      [passwordHash]
    );
    const userA = users.rows.find((user) => user.email === "inbox-a@adfix.local")!;
    const userB = users.rows.find((user) => user.email === "inbox-b@adfix.local")!;
    const clients = await pool.query<{ id: string; name: string }>(
      `INSERT INTO clients (name) VALUES ('Inbox Client A'), ('Inbox Client B') RETURNING id, name`
    );
    const clientA = clients.rows.find((client) => client.name === "Inbox Client A")!;
    const clientB = clients.rows.find((client) => client.name === "Inbox Client B")!;
    await pool.query(
      `INSERT INTO client_memberships (client_id, user_id, role)
       VALUES ($1, $3, 'reviewer'), ($2, $4, 'reviewer')`,
      [clientA.id, clientB.id, userA.id, userB.id]
    );
    const admin = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [adminUser.email]);
    const projects = await pool.query<{ id: string; client_id: string }>(
      `INSERT INTO projects (client_id, name, current_phase, priority, start_date, deadline, created_by)
       VALUES
         ($1, 'Inbox Project A', 'production', 'medium', CURRENT_DATE, CURRENT_DATE + 20, $3),
         ($2, 'Inbox Project B', 'production', 'medium', CURRENT_DATE, CURRENT_DATE + 20, $3)
       RETURNING id, client_id`,
      [clientA.id, clientB.id, admin.rows[0].id]
    );
    const projectA = projects.rows.find((project) => project.client_id === clientA.id)!;
    const projectB = projects.rows.find((project) => project.client_id === clientB.id)!;
    const files = await pool.query<{ id: string; project_id: string }>(
      `INSERT INTO files (project_id, file_name, file_type, storage_type, object_key, mime_type, file_size, uploaded_by)
       VALUES
         ($1, 'client-a.pdf', 'deliverable', 'local', 'client-a.pdf', 'application/pdf', 100, $3),
         ($2, 'client-b.pdf', 'deliverable', 'local', 'client-b.pdf', 'application/pdf', 100, $3)
       RETURNING id, project_id`,
      [projectA.id, projectB.id, admin.rows[0].id]
    );
    const fileA = files.rows.find((fileRow) => fileRow.project_id === projectA.id)!;
    const fileB = files.rows.find((fileRow) => fileRow.project_id === projectB.id)!;
    const deliverables = await pool.query<{ id: string; project_id: string }>(
      `INSERT INTO deliverables (project_id, title, status, created_by)
       VALUES ($1, 'Client A review', 'in_review', $3), ($2, 'Client B review', 'in_review', $3)
       RETURNING id, project_id`,
      [projectA.id, projectB.id, admin.rows[0].id]
    );
    const deliverableA = deliverables.rows.find((deliverable) => deliverable.project_id === projectA.id)!;
    const deliverableB = deliverables.rows.find((deliverable) => deliverable.project_id === projectB.id)!;
    const versions = await pool.query<{ id: string; deliverable_id: string }>(
      `INSERT INTO deliverable_versions (
         deliverable_id, file_id, version_number, submitted_by, client_submitted_by, client_submitted_at
       ) VALUES ($1, $3, 1, $5, $5, NOW() - INTERVAL '2 hours'),
                ($2, $4, 1, $5, $5, NOW() - INTERVAL '1 hour')
       RETURNING id, deliverable_id`,
      [deliverableA.id, deliverableB.id, fileA.id, fileB.id, admin.rows[0].id]
    );
    const versionA = versions.rows.find((version) => version.deliverable_id === deliverableA.id)!;

    const clientAuth = await loginAs(userA.email, password);
    const pending = await request(app)
      .get("/api/client-portal/reviews?status=pending")
      .set("Authorization", `Bearer ${clientAuth.accessToken}`);
    expect(pending.status).toBe(200);
    expect(pending.body.data).toEqual([
      expect.objectContaining({ versionId: versionA.id, deliverableTitle: "Client A review", canReview: true })
    ]);
    expect(pending.body.data.some((item: { deliverableTitle: string }) => item.deliverableTitle === "Client B review")).toBe(false);

    await pool.query(
      `INSERT INTO deliverable_reviews (deliverable_version_id, reviewer_id, decision, comment)
       VALUES ($1, $2, 'approved', 'Looks good')`,
      [versionA.id, userA.id]
    );
    await pool.query("UPDATE deliverables SET status = 'approved' WHERE id = $1", [deliverableA.id]);

    const reviewed = await request(app)
      .get("/api/client-portal/reviews?status=reviewed&sort=newest")
      .set("Authorization", `Bearer ${clientAuth.accessToken}`);
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.data).toEqual([
      expect.objectContaining({ versionId: versionA.id, review: expect.objectContaining({ decision: "approved", comment: "Looks good" }) })
    ]);
    expect(reviewed.body.meta.counts).toEqual({ pending: 0, reviewed: 1, history: 1 });

    const staffAuth = await login();
    const staffDenied = await request(app)
      .get("/api/client-portal/reviews")
      .set("Authorization", `Bearer ${staffAuth.accessToken}`);
    expect(staffDenied.status).toBe(403);
  });

  it("notifications: supports lifecycle views, archiving, stale targets, and pagination", async () => {
    const adminAuth = await login();
    const admin = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [adminUser.email]);
    const client = await pool.query<{ id: string }>("INSERT INTO clients (name) VALUES ('Notice Client') RETURNING id");
    const project = await pool.query<{ id: string }>(
      `INSERT INTO projects (client_id, name, start_date, deadline, created_by)
       VALUES ($1, 'Notice Project', CURRENT_DATE, CURRENT_DATE + 5, $2) RETURNING id`,
      [client.rows[0].id, admin.rows[0].id]
    );
    const regular = await pool.query<{ id: string }>(
      `INSERT INTO notifications (user_id, project_id, type, title, message)
       VALUES ($1, $2, 'project_update', 'General update', 'A general update') RETURNING id`,
      [admin.rows[0].id, project.rows[0].id]
    );
    const action = await pool.query<{ id: string }>(
      `INSERT INTO notifications (user_id, project_id, type, title, message, action_required, action_status)
       VALUES ($1, $2, 'deliverable_internal_review_requested', 'Decision needed', 'Review this', TRUE, 'open')
       RETURNING id`,
      [admin.rows[0].id, project.rows[0].id]
    );
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message, action_required, action_status, resolved_at)
       VALUES ($1, 'task_assigned', 'Resolved assignment', 'Already handled', TRUE, 'resolved', NOW())`,
      [admin.rows[0].id]
    );
    const fillerValues = Array.from({ length: 21 }, (_, index) => `('Page item ${index + 1}', 'Body ${index + 1}')`);
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, message)
       SELECT $1, 'project_update', item.title, item.message
       FROM (VALUES ${fillerValues.join(",")}) AS item(title, message)`,
      [admin.rows[0].id]
    );

    const actions = await request(app)
      .get("/api/notifications?view=action_required&pageSize=20")
      .set("Authorization", `Bearer ${adminAuth.accessToken}`);
    expect(actions.status).toBe(200);
    expect(actions.body.data.map((item: { id: string }) => item.id)).toEqual([action.rows[0].id]);

    const resolved = await request(app)
      .get("/api/notifications?view=resolved&pageSize=20")
      .set("Authorization", `Bearer ${adminAuth.accessToken}`);
    expect(resolved.status).toBe(200);
    expect(resolved.body.data).toHaveLength(1);
    expect(resolved.body.data[0].action_status).toBe("resolved");

    const archiveOpenAction = await request(app)
      .patch(`/api/notifications/${action.rows[0].id}/archive`)
      .set("Authorization", `Bearer ${adminAuth.accessToken}`);
    expect(archiveOpenAction.status).toBe(409);

    const archived = await request(app)
      .patch(`/api/notifications/${regular.rows[0].id}/archive`)
      .set("Authorization", `Bearer ${adminAuth.accessToken}`);
    expect(archived.status).toBe(200);
    const archiveView = await request(app)
      .get("/api/notifications?view=archived&pageSize=20")
      .set("Authorization", `Bearer ${adminAuth.accessToken}`);
    expect(archiveView.body.data.map((item: { id: string }) => item.id)).toContain(regular.rows[0].id);

    const secondPage = await request(app)
      .get("/api/notifications?view=all&page=2&pageSize=20")
      .set("Authorization", `Bearer ${adminAuth.accessToken}`);
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.meta.total).toBe(23);
    expect(secondPage.body.data).toHaveLength(3);

    await pool.query("UPDATE projects SET deleted_at = NOW() WHERE id = $1", [project.rows[0].id]);
    const stale = await request(app)
      .get("/api/notifications?view=action_required&pageSize=20")
      .set("Authorization", `Bearer ${adminAuth.accessToken}`);
    expect(stale.body.data[0]).toEqual(expect.objectContaining({ id: action.rows[0].id, target_available: false }));

    const archiveStaleAction = await request(app)
      .patch(`/api/notifications/${action.rows[0].id}/archive`)
      .set("Authorization", `Bearer ${adminAuth.accessToken}`);
    expect(archiveStaleAction.status).toBe(200);
  });
});
