import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage";
import { ClientReviewsPage } from "./ClientReviewsPage";
import { NotificationsPage } from "./NotificationsPage";

const mocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  apiDownload: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  auth: {
    accessToken: "token",
    user: { id: "staff-1", name: "Supervisor", email: "supervisor@example.com", accountType: "staff" as "staff" | "client", isAdmin: false }
  }
}));

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, apiRequest: mocks.apiRequest, apiDownload: mocks.apiDownload };
});

vi.mock("../state/auth", () => ({ useAuth: () => mocks.auth }));
vi.mock("../state/ui", () => ({ useUI: () => ({ success: mocks.success, error: mocks.error }) }));

function renderPage(route: string, element: React.ReactNode, extraRoutes?: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={route.split("?")[0]} element={element} />
          {extraRoutes}
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mocks.apiRequest.mockReset();
  mocks.apiDownload.mockReset();
  mocks.success.mockReset();
  mocks.error.mockReset();
  mocks.auth.user.accountType = "staff";
});

describe("Package C action experiences", () => {
  it("presents supervisor decisions, delivery risks, client waits, and workload", async () => {
    mocks.apiRequest.mockResolvedValue({
      data: {
        projectsByPhase: [], overdueTasksCount: 0, projectsCompletedThisMonth: 0, projectsCompletedThisQuarter: 0,
        attentionCounts: { internalReviews: 1, clientFeedback: 1, dueToday: 1, blockedTasks: 1, unresolvedClientReviews: 1 },
        internalReviewsAwaitingDecision: [{
          versionId: "version-1", deliverableTitle: "Launch film", projectId: "project-1", projectName: "Campaign", clientName: "Acme",
          versionNumber: 2, submittedAt: new Date().toISOString(), submittedByName: "Designer"
        }],
        clientFeedbackAwaitingResponse: [{
          notificationId: "notice-1", type: "deliverable_changes_requested", title: "Changes requested", message: "Please update the logo.",
          createdAt: new Date().toISOString(), versionId: "version-2", deliverableTitle: "Key visual", projectId: "project-1", projectName: "Campaign", clientName: "Acme"
        }],
        dueTodayAssignments: [{ id: "task-1", title: "Export assets", priority: "high", dueDate: "2026-07-21", projectId: "project-1", projectName: "Campaign", clientName: "Acme", assignees: [] }],
        blockedTasks: [{ id: "task-2", title: "Final voiceover", priority: "urgent", dueDate: null, projectId: "project-1", projectName: "Campaign", clientName: "Acme", assignees: [] }],
        unresolvedClientReviews: [{ versionId: "version-3", deliverableTitle: "Radio spot", projectId: "project-1", projectName: "Campaign", clientName: "Acme", versionNumber: 1, clientSubmittedAt: new Date().toISOString() }],
        workload: [{ userId: "staff-2", userName: "Creative Lead", avatarUrl: null, activeTasks: 4, dueToday: 1, overdueTasks: 0, blockedTasks: 1 }]
      }
    });

    renderPage("/dashboard", <DashboardPage />);

    expect(await screen.findByRole("heading", { name: "Supervisor desk" })).toBeInTheDocument();
    expect(screen.getByText("Launch film")).toBeInTheDocument();
    expect(screen.getByText("Please update the logo.", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Export assets")).toBeInTheDocument();
    expect(screen.getByText("Final voiceover")).toBeInTheDocument();
    expect(screen.getByText("Radio spot")).toBeInTheDocument();
    expect(screen.getByText("Creative Lead")).toBeInTheDocument();
  });

  it("uses a dedicated client review inbox and submits a pending review", async () => {
    const user = userEvent.setup();
    mocks.auth.user.accountType = "client";
    mocks.apiRequest.mockImplementation((path: string, options?: { method?: string }) => {
      if (options?.method === "POST") return Promise.resolve({ data: { id: "review-1" } });
      if (path.startsWith("/client-portal/reviews")) return Promise.resolve({
        data: [{
          versionId: "11111111-1111-4111-8111-111111111111", deliverableId: "deliverable-1", deliverableTitle: "Campaign poster", deliverableDescription: "Final poster design",
          deliverableStatus: "in_review", versionNumber: 1, submissionNote: "Ready for review", clientSubmittedAt: "2026-07-20T10:00:00.000Z",
          file: { id: "file-1", name: "poster.jpg", size: "120000", mimeType: "image/jpeg", storageType: "local", externalUrl: null },
          project: { id: "project-1", name: "Summer campaign", phase: "production", deadline: "2026-08-01" },
          client: { id: "client-1", name: "Acme" }, clientRole: "reviewer", review: null, canReview: true
        }],
        meta: { status: "pending", sort: "oldest", counts: { pending: 1, reviewed: 0, history: 1 } }
      });
      return Promise.resolve({});
    });

    renderPage("/portal/reviews", <ClientReviewsPage />);
    expect(await screen.findByRole("heading", { name: "Reviews" })).toBeInTheDocument();
    expect(screen.getByText("Campaign poster")).toBeInTheDocument();
    expect(screen.queryByText("Projects", { selector: "h2" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Review now" }));
    await user.click(screen.getByRole("button", { name: "Submit review" }));

    expect(mocks.apiRequest).toHaveBeenCalledWith(
      "/client-portal/versions/11111111-1111-4111-8111-111111111111/reviews",
      expect.objectContaining({ method: "POST", body: { decision: "approved", comment: null } })
    );
  });

  it("navigates a client notification immediately using a portal-safe target", async () => {
    const user = userEvent.setup();
    mocks.auth.user.accountType = "client";
    let resolveMarkRead: ((value: unknown) => void) | undefined;
    mocks.apiRequest.mockImplementation((path: string, options?: { method?: string }) => {
      if (path.endsWith("/read") && options?.method === "PATCH") {
        return new Promise((resolve) => { resolveMarkRead = resolve; });
      }
      if (path.startsWith("/notifications")) return Promise.resolve({
        data: [{
          id: "notice-1", type: "deliverable_client_review_requested", title: "Review ready", message: "A deliverable is ready.",
          is_read: false, created_at: "2026-07-21T08:00:00.000Z", project_id: "project-1", task_id: null,
          metadata: { href: "/projects/project-1?tab=deliverables" }, action_required: true, action_status: "open",
          resolution_reason: null, archived_at: null, target_available: true
        }],
        meta: { page: 1, pageSize: 20, total: 21, unreadCount: 1, openActionCount: 1 }
      });
      return Promise.resolve({});
    });

    renderPage(
      "/notifications?view=all&page=1",
      <NotificationsPage />,
      <Route path="/portal/projects/:projectId" element={<div>Client project destination</div>} />
    );

    expect(await screen.findByText("Review ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("Client project destination")).toBeInTheDocument();

    await act(async () => { resolveMarkRead?.({}); });
  });
});
