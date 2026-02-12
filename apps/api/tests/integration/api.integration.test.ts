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

    const taskActionCounts = await pool.query<{ action: string; count: string }>(
      `SELECT action, COUNT(*)::text AS count
       FROM activity_log
       WHERE action IN ('task_created', 'task_updated', 'task_status_changed', 'task_deleted')
       GROUP BY action`
    );

    const counts = Object.fromEntries(
      taskActionCounts.rows.map((row) => [row.action, Number(row.count)])
    );

    expect(counts.task_created).toBe(3);
    expect(counts.task_updated).toBe(1);
    expect(counts.task_status_changed).toBe(4);
    expect(counts.task_deleted).toBe(1);
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
        role: "Designer"
      });

    expect(addMemberResponse.status).toBe(201);
    expect(addMemberResponse.body.data.user_id).toBe(secondUserId);
    expect(addMemberResponse.body.data.role).toBe("Designer");

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
});
