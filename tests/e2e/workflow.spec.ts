import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

type JsonRecord = Record<string, any>;

async function bodyOf(response: APIResponse, status: number) {
  const text = response.status() === 204 ? "" : await response.text();
  expect(response.status(), text).toBe(status);
  const body = text ? JSON.parse(text) : {};
  return body as JsonRecord;
}

function bearer(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

async function login(request: APIRequestContext, email: string, password: string) {
  const body = await bodyOf(await request.post("/api/v1/auth/login", { data: { email, password } }), 200);
  return body.accessToken as string;
}

async function uploadText(
  request: APIRequestContext,
  accessToken: string,
  projectId: string,
  name: string,
  content: string
) {
  const body = await bodyOf(await request.post("/api/v1/files/upload-binary", {
    headers: bearer(accessToken),
    multipart: {
      projectId,
      fileType: "deliverable",
      file: { name, mimeType: "text/plain", buffer: Buffer.from(content) }
    }
  }), 201);
  return body.data as JsonRecord;
}

test("complete staff, supervisor, client review, notification, file, and Delivery journey", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "The full workflow is covered once; responsive behavior has separate mobile checks.");
  test.setTimeout(120_000);

  const suffix = `${Date.now()}-${testInfo.workerIndex}`;
  const adminToken = await login(request, "admin@adfix.local", "ChangeMe123!");

  const client = await bodyOf(await request.post("/api/v1/clients", {
    headers: bearer(adminToken),
    data: { name: `Acceptance client ${suffix}`, email: `client-${suffix}@example.test` }
  }), 201);
  const otherClient = await bodyOf(await request.post("/api/v1/clients", {
    headers: bearer(adminToken),
    data: { name: `Isolated client ${suffix}` }
  }), 201);

  const temporaryPassword = "TemporaryDesigner123!";
  const permanentPassword = "PermanentDesigner456!";
  const designerEmail = `designer-${suffix}@adfix.local`;
  const designer = await bodyOf(await request.post("/api/v1/users", {
    headers: bearer(adminToken),
    data: { name: "Acceptance Designer", email: designerEmail, password: temporaryPassword }
  }), 201);
  const temporaryDesignerToken = await login(request, designerEmail, temporaryPassword);
  await bodyOf(await request.post("/api/v1/users/me/change-password", {
    headers: bearer(temporaryDesignerToken),
    data: { currentPassword: temporaryPassword, newPassword: permanentPassword }
  }), 204);
  const designerToken = await login(request, designerEmail, permanentPassword);

  const project = await bodyOf(await request.post("/api/v1/projects", {
    headers: bearer(adminToken),
    data: {
      clientId: client.data.id,
      name: `Acceptance campaign ${suffix}`,
      startDate: "2026-07-01",
      deadline: "2026-09-30"
    }
  }), 201);
  await bodyOf(await request.post(`/api/v1/projects/${project.data.id}/team`, {
    headers: bearer(adminToken),
    data: { userId: designer.data.id, role: "member" }
  }), 201);

  const task = await bodyOf(await request.post("/api/v1/tasks", {
    headers: bearer(adminToken),
    data: {
      projectId: project.data.id,
      title: "Produce the acceptance master",
      phase: "production",
      priority: "high",
      assigneeIds: [designer.data.id],
      labels: [{ name: "Acceptance", color: "violet" }]
    }
  }), 201);
  for (const status of ["in_progress", "completed"]) {
    await bodyOf(await request.patch(`/api/v1/tasks/${task.data.id}/status`, {
      headers: bearer(designerToken),
      data: { status }
    }), 200);
  }

  const reviewerEmail = `reviewer-${suffix}@example.test`;
  const reviewerPassword = "ReviewerAcceptance123!";
  const invitation = await bodyOf(await request.post("/api/v1/client-invitations", {
    headers: bearer(adminToken),
    data: { clientId: client.data.id, email: reviewerEmail, role: "reviewer" }
  }), 201);
  const inviteToken = String(invitation.data.inviteUrl).split("/invite/")[1];
  const acceptance = await bodyOf(await request.post(`/api/v1/client-invitations/token/${inviteToken}/accept`, {
    data: { name: "Acceptance Reviewer", password: reviewerPassword }
  }), 201);
  const clientToken = acceptance.accessToken as string;

  const portalProjects = await bodyOf(await request.get("/api/v1/client-portal/projects", {
    headers: bearer(clientToken)
  }), 200);
  expect(portalProjects.data.map((item: JsonRecord) => item.id)).toEqual([project.data.id]);

  const otherProject = await bodyOf(await request.post("/api/v1/projects", {
    headers: bearer(adminToken),
    data: {
      clientId: otherClient.data.id,
      name: `Private project ${suffix}`,
      startDate: "2026-07-01",
      deadline: "2026-09-30"
    }
  }), 201);
  await bodyOf(await request.get(`/api/v1/client-portal/projects/${otherProject.data.id}`, {
    headers: bearer(clientToken)
  }), 404);

  const deliverable = await bodyOf(await request.post("/api/v1/deliverables", {
    headers: bearer(designerToken),
    data: { projectId: project.data.id, title: `Campaign master ${suffix}`, taskIds: [task.data.id] }
  }), 201);
  const firstFile = await uploadText(request, designerToken, project.data.id, "master-v1.txt", "first acceptance version");
  const firstVersion = await bodyOf(await request.post(`/api/v1/deliverables/${deliverable.data.id}/versions`, {
    headers: bearer(designerToken),
    data: { fileId: firstFile.id, submissionNote: "First version for supervisor" }
  }), 201);

  const supervisorNotifications = await bodyOf(await request.get("/api/v1/notifications?view=action_required&pageSize=50", {
    headers: bearer(adminToken)
  }), 200);
  expect(supervisorNotifications.data.some((item: JsonRecord) => item.type === "deliverable_internal_review_requested")).toBe(true);

  await bodyOf(await request.post(`/api/v1/deliverables/versions/${firstVersion.data.id}/internal-review`, {
    headers: bearer(adminToken),
    data: { decision: "approved", comment: "Approved for client review" }
  }), 201);
  await bodyOf(await request.post(`/api/v1/deliverables/versions/${firstVersion.data.id}/submit-client`, {
    headers: bearer(adminToken)
  }), 200);

  const pendingInbox = await bodyOf(await request.get("/api/v1/client-portal/reviews?status=pending&sort=oldest", {
    headers: bearer(clientToken)
  }), 200);
  expect(pendingInbox.data.some((item: JsonRecord) => item.versionId === firstVersion.data.id)).toBe(true);
  const changeRequest = await bodyOf(await request.post(`/api/v1/client-portal/versions/${firstVersion.data.id}/reviews`, {
    headers: bearer(clientToken),
    data: { decision: "changes_requested", comment: "Please refine the final wording." }
  }), 201);

  const designerNotifications = await bodyOf(await request.get("/api/v1/notifications?view=all&pageSize=50", {
    headers: bearer(designerToken)
  }), 200);
  expect(designerNotifications.data.some((item: JsonRecord) => item.type === "deliverable_client_feedback_received")).toBe(true);

  await bodyOf(await request.post(`/api/v1/deliverables/versions/${firstVersion.data.id}/forward-feedback`, {
    headers: bearer(adminToken),
    data: {
      sourceReviewId: changeRequest.data.id,
      taskIds: [task.data.id],
      body: "Refine the final wording and prepare a second version."
    }
  }), 201);

  const secondFile = await uploadText(request, designerToken, project.data.id, "master-v2.txt", "revised acceptance version");
  const secondVersion = await bodyOf(await request.post(`/api/v1/deliverables/${deliverable.data.id}/versions`, {
    headers: bearer(designerToken),
    data: { fileId: secondFile.id, submissionNote: "Client wording refined" }
  }), 201);
  await bodyOf(await request.post(`/api/v1/deliverables/versions/${secondVersion.data.id}/internal-review`, {
    headers: bearer(adminToken),
    data: { decision: "approved" }
  }), 201);
  await bodyOf(await request.post(`/api/v1/deliverables/versions/${secondVersion.data.id}/submit-client`, {
    headers: bearer(adminToken)
  }), 200);
  await bodyOf(await request.post(`/api/v1/client-portal/versions/${secondVersion.data.id}/reviews`, {
    headers: bearer(clientToken),
    data: { decision: "approved", comment: "Approved for delivery." }
  }), 201);

  const downloaded = await request.get(`/api/v1/files/${secondFile.id}/content`, { headers: bearer(clientToken) });
  expect(downloaded.status()).toBe(200);
  expect((await downloaded.body()).toString()).toBe("revised acceptance version");

  const isolatedReviewerEmail = `isolated-${suffix}@example.test`;
  const isolatedInvitation = await bodyOf(await request.post("/api/v1/client-invitations", {
    headers: bearer(adminToken),
    data: { clientId: otherClient.data.id, email: isolatedReviewerEmail, role: "reviewer" }
  }), 201);
  const isolatedInviteToken = String(isolatedInvitation.data.inviteUrl).split("/invite/")[1];
  const isolatedAcceptance = await bodyOf(await request.post(`/api/v1/client-invitations/token/${isolatedInviteToken}/accept`, {
    data: { name: "Isolated Reviewer", password: "IsolatedReviewer123!" }
  }), 201);
  const forbiddenFile = await request.get(`/api/v1/files/${secondFile.id}/content`, {
    headers: bearer(isolatedAcceptance.accessToken)
  });
  expect(forbiddenFile.status()).toBe(403);

  for (const phase of ["strategy_planning", "production", "post_production"]) {
    await bodyOf(await request.patch(`/api/v1/projects/${project.data.id}/phase`, {
      headers: bearer(adminToken),
      data: { phase }
    }), 200);
  }
  const mainDeliveryWarning = await request.patch(`/api/v1/projects/${project.data.id}/phase`, {
    headers: { ...bearer(adminToken), "content-type": "application/json" },
    data: { phase: "delivery" }
  });
  expect(mainDeliveryWarning.status()).toBe(409);
  await bodyOf(await request.patch(`/api/v1/projects/${project.data.id}/phase`, {
    headers: { ...bearer(adminToken), "content-type": "application/json" },
    data: { phase: "delivery", confirmUnresolvedReviews: true }
  }), 200);

  const lockedReview = await request.post(`/api/v1/client-portal/versions/${secondVersion.data.id}/reviews`, {
    headers: bearer(clientToken),
    data: { decision: "approved" }
  });
  expect(lockedReview.status()).toBe(409);

  const unresolvedFile = await uploadText(request, adminToken, otherProject.data.id, "unresolved.txt", "unresolved client review");
  const unresolvedDeliverable = await bodyOf(await request.post("/api/v1/deliverables", {
    headers: bearer(adminToken),
    data: { projectId: otherProject.data.id, title: `Unresolved review ${suffix}` }
  }), 201);
  const unresolvedVersion = await bodyOf(await request.post(`/api/v1/deliverables/${unresolvedDeliverable.data.id}/versions`, {
    headers: bearer(adminToken),
    data: { fileId: unresolvedFile.id }
  }), 201);
  await bodyOf(await request.post(`/api/v1/deliverables/versions/${unresolvedVersion.data.id}/internal-review`, {
    headers: bearer(adminToken),
    data: { decision: "approved" }
  }), 201);
  await bodyOf(await request.post(`/api/v1/deliverables/versions/${unresolvedVersion.data.id}/submit-client`, {
    headers: bearer(adminToken)
  }), 200);
  for (const phase of ["strategy_planning", "production", "post_production"]) {
    await bodyOf(await request.patch(`/api/v1/projects/${otherProject.data.id}/phase`, {
      headers: bearer(adminToken),
      data: { phase }
    }), 200);
  }
  const warning = await request.patch(`/api/v1/projects/${otherProject.data.id}/phase`, {
    headers: bearer(adminToken),
    data: { phase: "delivery" }
  });
  expect(warning.status()).toBe(409);
  await bodyOf(await request.patch(`/api/v1/projects/${otherProject.data.id}/phase`, {
    headers: bearer(adminToken),
    data: { phase: "delivery", confirmUnresolvedReviews: true }
  }), 200);

  await bodyOf(await request.post("/api/v1/auth/refresh", { data: {} }), 200);

  await page.goto("/login");
  await page.getByLabel("Email").fill(reviewerEmail);
  await page.getByLabel("Password").fill(reviewerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/portal\/projects$/);
  await page.goto("/portal/reviews?status=history");
  await expect(page.getByText(`Campaign master ${suffix}`, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /approve/i })).toHaveCount(0);
});
