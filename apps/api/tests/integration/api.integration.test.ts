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
    `TRUNCATE TABLE notifications, activity_log, project_team, task_comments, files, tasks, projects, auth_sessions, clients, users RESTART IDENTITY CASCADE`
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

    const docsResponse = await request(app).get("/api/docs.json");
    expect(docsResponse.status).toBe(200);
    expect(docsResponse.body.openapi).toBe("3.0.3");
    expect(docsResponse.body.info.title).toBe("Adfix PM API");
    expect(docsResponse.body.paths).toHaveProperty("/users/audit-logs");
    expect(docsResponse.body.paths).toHaveProperty("/tasks/bulk/status");
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

  it("auth: signup creates account, returns tokens, and rejects duplicate email", async () => {
    const signupEmail = "signup-user@adfix.local";
    const signupPassword = "SignupPass123!";

    const signupResponse = await request(app).post("/api/auth/signup").send({
      email: signupEmail,
      name: "Signup User",
      password: signupPassword
    });

    expect(signupResponse.status).toBe(201);
    expect(signupResponse.body.accessToken).toBeTypeOf("string");
    expect(signupResponse.body.refreshToken).toBeTypeOf("string");
    expect(signupResponse.body.user.email).toBe(signupEmail);
    expect(signupResponse.body.user.isAdmin).toBe(false);

    const duplicateSignupResponse = await request(app).post("/api/auth/signup").send({
      email: signupEmail,
      name: "Signup User Again",
      password: signupPassword
    });

    expect(duplicateSignupResponse.status).toBe(409);

    const loginResponse = await request(app).post("/api/auth/login").send({
      email: signupEmail,
      password: signupPassword
    });
    expect(loginResponse.status).toBe(200);

    const signupLogCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM activity_log
       WHERE action = 'auth_signup'
         AND user_id = $1`,
      [signupResponse.body.user.id]
    );
    expect(Number(signupLogCount.rows[0].count)).toBe(1);
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

    const taskA = await request(app)
      .post("/api/tasks")
      .set("Authorization", `Bearer ${auth.accessToken}`)
      .send({
        projectId,
        title: "Overdue pending task",
        phase: "production",
        dueDate: "2020-01-01"
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
    expect(counts.task_updated).toBe(1);
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

    const listResponse = await request(app)
      .get(`/api/files/project/${projectId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.length).toBe(2);

    const deleteResponse = await request(app)
      .delete(`/api/files/${linkedFileId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(deleteResponse.status).toBe(204);

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
    expect(counts.file_linked).toBe(1);
    expect(counts.file_deleted).toBe(1);
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

    const outsiderPasswordHash = await bcrypt.hash("OutsiderPass123!", 12);
    await pool.query(
      `INSERT INTO users (email, name, password_hash, is_active, created_at, updated_at)
       VALUES ('outsider-admin-controls@adfix.local', 'Outsider Controls', $1, TRUE, NOW(), NOW())`,
      [outsiderPasswordHash]
    );
    const outsiderAuth = await loginAs("outsider-admin-controls@adfix.local", "OutsiderPass123!");

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
    expect(listTeamAfterReset.body.data.length).toBe(0);

    const auditLogsResponse = await request(app)
      .get("/api/users/audit-logs")
      .query({ action: "user_status_changed", userId: adminUserId })
      .set("Authorization", `Bearer ${adminAuth.accessToken}`);
    expect(auditLogsResponse.status).toBe(200);
    expect(Array.isArray(auditLogsResponse.body.data)).toBe(true);
    expect(auditLogsResponse.body.data.length).toBeGreaterThan(0);
  });

  it("project team: add/list/remove members with activity logs", async () => {
    const auth = await login();

    const meResponse = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(meResponse.status).toBe(200);

    const secondUserPasswordHash = await bcrypt.hash("TeamUserPass123!", 12);
    const secondUserInsert = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, is_active, created_at, updated_at)
       VALUES ('teammate@adfix.local', 'Teammate User', $1, TRUE, NOW(), NOW())
       RETURNING id`,
      [secondUserPasswordHash]
    );
    const secondUserId = secondUserInsert.rows[0].id;

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

    const listMembersResponse = await request(app)
      .get(`/api/projects/${projectId}/team`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(listMembersResponse.status).toBe(200);
    expect(Array.isArray(listMembersResponse.body.data)).toBe(true);
    expect(listMembersResponse.body.data.length).toBe(1);
    expect(listMembersResponse.body.data[0].user_id).toBe(secondUserId);

    const removeMemberResponse = await request(app)
      .delete(`/api/projects/${projectId}/team/${secondUserId}`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(removeMemberResponse.status).toBe(204);

    const listAfterRemoveResponse = await request(app)
      .get(`/api/projects/${projectId}/team`)
      .set("Authorization", `Bearer ${auth.accessToken}`);

    expect(listAfterRemoveResponse.status).toBe(200);
    expect(listAfterRemoveResponse.body.data.length).toBe(0);

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
    expect(listResponse.body.data.length).toBe(2);
    expect(listResponse.body.meta.unreadCount).toBe(2);
    expect(listResponse.body.data[0].type).toBe("task_assigned");
    expect(listResponse.body.data[1].type).toBe("project_team_assigned");

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
    expect(unreadOnlyResponse.body.data.length).toBe(1);
    expect(unreadOnlyResponse.body.meta.unreadCount).toBe(1);

    const readAllResponse = await request(app)
      .post("/api/notifications/read-all")
      .set("Authorization", `Bearer ${assigneeAuth.accessToken}`);

    expect(readAllResponse.status).toBe(200);
    expect(readAllResponse.body.data.updatedCount).toBe(1);

    const unreadAfterReadAll = await request(app)
      .get("/api/notifications")
      .query({ unreadOnly: true })
      .set("Authorization", `Bearer ${assigneeAuth.accessToken}`);

    expect(unreadAfterReadAll.status).toBe(200);
    expect(unreadAfterReadAll.body.data.length).toBe(0);
    expect(unreadAfterReadAll.body.meta.unreadCount).toBe(0);
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
      .send({ taskIds });

    expect(bulkDelete.status).toBe(200);
    expect(bulkDelete.body.data.deletedCount).toBe(3);

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
    expect(Number(bulkDeleteLogs.rows[0].count)).toBe(3);
  });
});
