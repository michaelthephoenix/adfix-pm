import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientProjectDetailPage } from "../pages/ClientProjectDetailPage";
import { ProjectDeliverablesPanel } from "./ProjectDeliverablesPanel";
import { ProjectFileUpload } from "./ProjectFileUpload";
import { MAX_UPLOAD_BYTES } from "./UploadSizeAlert";

const apiRequestMock = vi.fn();
const apiUploadMock = vi.fn();
vi.mock("../lib/api", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
  apiUpload: (...args: unknown[]) => apiUploadMock(...args),
  apiAssetUrl: (path: string) => `/api/v1${path}`,
  apiDownload: vi.fn(),
  ApiError: class ApiError extends Error {}
}));
vi.mock("../state/auth", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "supervisor-1" } }) }));
vi.mock("../state/ui", () => ({ useUI: () => ({ success: vi.fn(), error: vi.fn(), confirm: vi.fn().mockResolvedValue(true) }) }));

const internalReviewDeliverable = {
  id: "deliverable-1",
  title: "Campaign film",
  description: "Launch master",
  status: "internal_review",
  tasks: [{ id: "task-1", title: "Edit campaign film", status: "completed" }],
  versions: [{
    id: "version-1",
    file_id: "file-1",
    file_name: "campaign.mp4",
    file_size: "2048",
    mime_type: "video/mp4",
    storage_type: "local",
    external_url: null,
    version_number: 1,
    submission_note: "Ready for internal review",
    submitted_by_name: "Project Designer",
    submitted_at: "2026-07-20T08:00:00.000Z",
    client_submitted_by: null,
    client_submitted_at: null,
    reviews: [],
    internal_reviews: [],
    messages: [],
    feedback_forward_count: 0
  }]
};

function renderWithClient(element: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
}

describe("deliverable approval workflow", () => {
  beforeEach(() => {
    apiRequestMock.mockReset();
    apiUploadMock.mockReset();
  });

  it("shows the internal approval request only to a supervisor", async () => {
    apiRequestMock.mockResolvedValue({ data: [internalReviewDeliverable], meta: { canSupervise: true } });
    const user = userEvent.setup();
    renderWithClient(<ProjectDeliverablesPanel projectId="project-1" canWrite canSupervise deliveryLocked={false} />);

    expect(await screen.findByText("Campaign film")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review internally" }));
    expect(screen.getByRole("dialog", { name: /internal review: campaign film/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve internally" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Return changes" })).toBeInTheDocument();
  });

  it("keeps a supervisor note in the review dialog when submission fails", async () => {
    apiRequestMock.mockImplementation((_path: string, options?: { method?: string }) => {
      if (options?.method === "POST") return Promise.reject(new Error("offline"));
      return Promise.resolve({ data: [internalReviewDeliverable], meta: { canSupervise: true } });
    });
    const user = userEvent.setup();
    renderWithClient(<ProjectDeliverablesPanel projectId="project-1" canWrite canSupervise deliveryLocked={false} />);

    await user.click(await screen.findByRole("button", { name: "Review internally" }));
    const note = screen.getByLabelText(/Supervisor note/i);
    fireEvent.change(note, { target: { value: "Approved once the export checksum is confirmed." } });
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not record the internal review.");
    expect(note).toHaveValue("Approved once the export checksum is confirmed.");
    expect(screen.getByRole("dialog", { name: /internal review: campaign film/i })).toBeInTheDocument();
  }, 10_000);

  it("shows every deliverable version and its complete decision timeline", async () => {
    const historicalDeliverable = {
      ...internalReviewDeliverable,
      status: "approved",
      versions: [
        {
          ...internalReviewDeliverable.versions[0],
          id: "version-2",
          file_id: "file-2",
          file_name: "campaign-v2.mp4",
          version_number: 2,
          submission_note: "Logo and opening copy updated",
          client_submitted_by: "supervisor-1",
          client_submitted_by_name: "Supervisor One",
          client_submitted_at: "2026-07-21T10:00:00.000Z",
          client_withdrawn_by: null,
          client_withdrawn_by_name: null,
          client_withdrawn_at: null,
          internal_reviews: [{ id: "internal-2", decision: "approved", comment: "Ready", reviewer_name: "Supervisor One", created_at: "2026-07-21T09:00:00.000Z" }],
          reviews: [{ id: "client-2", decision: "approved", comment: "Approved for launch", reviewer_name: "Client Reviewer", created_at: "2026-07-21T11:00:00.000Z" }]
        },
        {
          ...internalReviewDeliverable.versions[0],
          client_submitted_by: "supervisor-1",
          client_submitted_by_name: "Supervisor One",
          client_submitted_at: "2026-07-20T10:00:00.000Z",
          client_withdrawn_by: "supervisor-1",
          client_withdrawn_by_name: "Supervisor One",
          client_withdrawn_at: "2026-07-20T12:00:00.000Z",
          internal_reviews: [{ id: "internal-1", decision: "approved", comment: "Show the client", reviewer_name: "Supervisor One", created_at: "2026-07-20T09:00:00.000Z" }],
          reviews: [{ id: "client-1", decision: "changes_requested", comment: "Make the logo larger", reviewer_name: "Client Reviewer", created_at: "2026-07-20T11:00:00.000Z" }],
          messages: [{ id: "message-1", author_name: "Supervisor One", author_type: "staff", body: "The team is revising this now.", created_at: "2026-07-20T11:30:00.000Z" }]
        }
      ]
    };
    apiRequestMock.mockResolvedValue({ data: [historicalDeliverable], meta: { canSupervise: true } });
    const user = userEvent.setup();
    renderWithClient(<ProjectDeliverablesPanel projectId="project-1" canWrite canSupervise deliveryLocked={false} />);

    const heading = await screen.findByText("Version history");
    const history = heading.closest("section");
    expect(history).not.toBeNull();
    const historyView = within(history as HTMLElement);
    expect(historyView.getByText("Version 2")).toBeInTheDocument();
    await user.click(historyView.getByText("Version 1"));
    expect(historyView.getByText("Make the logo larger")).toBeInTheDocument();
    expect(historyView.getByText("The team is revising this now.")).toBeInTheDocument();
    expect(historyView.getByText("Pulled back from client review")).toBeInTheDocument();
    expect(history).toHaveTextContent("Supervisor One");
    expect(historyView.getByText("Approved by the client")).toBeInTheDocument();
  });

  it("opens a supported deliverable in an on-demand in-app preview", async () => {
    apiRequestMock.mockImplementation((path: string) => {
      if (path === "/files/file-1/preview-session") {
        return Promise.resolve({
          data: {
            path: "/files/file-1/preview",
            fileName: "campaign.mp4",
            mimeType: "video/mp4",
            kind: "video",
            expiresInSeconds: 300
          }
        });
      }
      return Promise.resolve({ data: [internalReviewDeliverable], meta: { canSupervise: true } });
    });
    const user = userEvent.setup();
    renderWithClient(<ProjectDeliverablesPanel projectId="project-1" canWrite canSupervise deliveryLocked={false} />);

    await user.click(await screen.findByRole("button", { name: "Preview" }));
    expect(screen.getByRole("dialog", { name: "campaign.mp4" })).toBeInTheDocument();
    const video = await screen.findByLabelText("Preview of campaign.mp4");
    expect(video).toHaveAttribute("preload", "metadata");
    expect(video).toHaveAttribute("src", "/api/v1/files/file-1/preview");
  });

  it("keeps approval controls and raw client conversation away from production members", async () => {
    apiRequestMock.mockResolvedValue({ data: [internalReviewDeliverable], meta: { canSupervise: false } });
    renderWithClient(<ProjectDeliverablesPanel projectId="project-1" canWrite canSupervise={false} deliveryLocked={false} />);

    expect(await screen.findByText("Campaign film")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review internally" })).not.toBeInTheDocument();
    expect(screen.queryByText("Client conversation")).not.toBeInTheDocument();
  });

  it("keeps an internally approved deliverable private until a supervisor submits it", async () => {
    const approvedDeliverable = { ...internalReviewDeliverable, status: "internal_approved" };
    apiRequestMock.mockResolvedValue({ data: [approvedDeliverable], meta: { canSupervise: true } });
    const supervisorView = renderWithClient(<ProjectDeliverablesPanel projectId="project-1" canWrite canSupervise deliveryLocked={false} />);

    expect(await screen.findByText("Not visible to the client yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit to client for review" })).toBeInTheDocument();

    supervisorView.unmount();
    apiRequestMock.mockResolvedValue({ data: [approvedDeliverable], meta: { canSupervise: false } });
    renderWithClient(<ProjectDeliverablesPanel projectId="project-1" canWrite canSupervise={false} deliveryLocked={false} />);

    expect(await screen.findByText("Not visible to the client yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit to client for review" })).not.toBeInTheDocument();
  });

  it("lets only the original supervisor pull an active client review back", async () => {
    const clientReviewDeliverable = {
      ...internalReviewDeliverable,
      status: "in_review",
      versions: [{
        ...internalReviewDeliverable.versions[0],
        client_submitted_by: "supervisor-1",
        client_submitted_at: "2026-07-20T09:00:00.000Z"
      }]
    };
    apiRequestMock.mockResolvedValue({ data: [clientReviewDeliverable], meta: { canSupervise: true } });
    const user = userEvent.setup();
    const submitterView = renderWithClient(<ProjectDeliverablesPanel projectId="project-1" canWrite canSupervise deliveryLocked={false} />);

    await user.click(await screen.findByRole("button", { name: "Pull back from client review" }));
    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith(
      "/deliverables/versions/version-1/withdraw-client",
      expect.objectContaining({
        method: "POST",
        accessToken: "token",
        idempotencyKey: expect.any(String)
      })
    ));

    submitterView.unmount();
    apiRequestMock.mockReset();
    apiRequestMock.mockResolvedValue({
      data: [{
        ...clientReviewDeliverable,
        versions: [{ ...clientReviewDeliverable.versions[0], client_submitted_by: "another-supervisor" }]
      }],
      meta: { canSupervise: true }
    });
    renderWithClient(<ProjectDeliverablesPanel projectId="project-1" canWrite canSupervise deliveryLocked={false} />);

    expect(await screen.findByText("Campaign film")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pull back from client review" })).not.toBeInTheDocument();
  });

  it("uses a file-type preview and circular progress instead of the native file control", async () => {
    const draftDeliverable = { ...internalReviewDeliverable, status: "draft", versions: [] };
    apiRequestMock.mockResolvedValue({ data: [draftDeliverable], meta: { canSupervise: true } });
    let resolveUpload!: (value: { data: { id: string } }) => void;
    apiUploadMock.mockImplementation((_path, _formData, _accessToken, options: { onProgress?: (value: number) => void }) => {
      options.onProgress?.(42);
      return new Promise((resolve) => { resolveUpload = resolve; });
    });
    const user = userEvent.setup();
    renderWithClient(<ProjectDeliverablesPanel projectId="project-1" canWrite canSupervise deliveryLocked={false} />);

    await user.click(await screen.findByRole("button", { name: "Submit first version" }));
    const input = screen.getByLabelText("Version file");
    const file = new File([new Uint8Array(1024)], "campaign-preview.jpg", { type: "image/jpeg" });
    await user.upload(input, file);

    expect(screen.getByText("campaign-preview.jpg")).toBeInTheDocument();
    expect(screen.getByText("JPG · 1 KB")).toBeInTheDocument();
    expect(screen.queryByText("Choose File")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Send for internal approval" }));
    expect(await screen.findByRole("progressbar", { name: "Uploading campaign-preview.jpg" })).toHaveAttribute("aria-valuenow", "42");
    resolveUpload({ data: { id: "file-1" } });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /submit the first version/i })).not.toBeInTheDocument());
  });

  it("immediately alerts when a deliverable file exceeds 50 MB", async () => {
    const draftDeliverable = { ...internalReviewDeliverable, status: "draft", versions: [] };
    apiRequestMock.mockResolvedValue({ data: [draftDeliverable], meta: { canSupervise: true } });
    const user = userEvent.setup();
    renderWithClient(<ProjectDeliverablesPanel projectId="project-1" canWrite canSupervise deliveryLocked={false} />);

    await user.click(await screen.findByRole("button", { name: "Submit first version" }));
    const oversizedFile = new File(["oversized"], "campaign-master.mp4", { type: "video/mp4" });
    Object.defineProperty(oversizedFile, "size", { value: MAX_UPLOAD_BYTES + 1024 * 1024 });
    await user.upload(screen.getByLabelText("Version file"), oversizedFile);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("File is too large");
    expect(alert).toHaveTextContent("campaign-master.mp4 is 51.0 MB");
    expect(alert).toHaveTextContent("maximum upload size is 50 MB");
    expect(alert).toHaveTextContent("share it as a link");
    expect(screen.getByRole("button", { name: "Send for internal approval" })).toBeDisabled();
    expect(apiUploadMock).not.toHaveBeenCalled();
  });

  it("immediately alerts when a project library file exceeds 50 MB", async () => {
    const user = userEvent.setup();
    renderWithClient(<ProjectFileUpload projectId="project-1" open onOpenChange={vi.fn()} />);
    const oversizedFile = new File(["oversized"], "source-footage.mov", { type: "video/quicktime" });
    Object.defineProperty(oversizedFile, "size", { value: MAX_UPLOAD_BYTES + 2 * 1024 * 1024 });
    await user.upload(screen.getByLabelText("Project file"), oversizedFile);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("source-footage.mov is 52.0 MB");
    expect(alert).toHaveTextContent("maximum upload size is 50 MB");
    expect(screen.getByRole("button", { name: "Upload file" })).toBeDisabled();
    expect(apiUploadMock).not.toHaveBeenCalled();
  });

  it("submits a linked deliverable through the same internal approval flow", async () => {
    const draftDeliverable = { ...internalReviewDeliverable, status: "draft", versions: [] };
    apiRequestMock.mockImplementation((path: string) => {
      if (path === "/files/link") return Promise.resolve({ data: { id: "linked-file-1" } });
      if (path === "/deliverables/deliverable-1/versions") return Promise.resolve({ data: { id: "linked-version-1" } });
      return Promise.resolve({ data: [draftDeliverable], meta: { canSupervise: true } });
    });
    const user = userEvent.setup();
    renderWithClient(<ProjectDeliverablesPanel projectId="project-1" canWrite canSupervise deliveryLocked={false} />);

    await user.click(await screen.findByRole("button", { name: "Submit first version" }));
    await user.click(screen.getByRole("tab", { name: /share a link/i }));
    await user.type(screen.getByLabelText("Deliverable name"), "Frame review");
    await user.type(screen.getByLabelText("Review link"), "https://review.example.com/campaign-v1");

    const openLink = screen.getByRole("link", { name: "Open Frame review on External link" });
    expect(openLink).toHaveAttribute("href", "https://review.example.com/campaign-v1");
    await user.click(screen.getByRole("button", { name: "Send for internal approval" }));

    await waitFor(() => expect(apiRequestMock).toHaveBeenCalledWith("/files/link", expect.objectContaining({
      method: "POST",
      body: expect.objectContaining({
        projectId: "project-1",
        fileName: "Frame review",
        storageType: "external",
        externalUrl: "https://review.example.com/campaign-v1"
      })
    })));
    expect(apiRequestMock).toHaveBeenCalledWith("/deliverables/deliverable-1/versions", expect.objectContaining({
      method: "POST",
      body: { fileId: "linked-file-1", submissionNote: null }
    }));
  }, 10_000);

  it("presents a client-visible linked deliverable as an obvious clickable card", async () => {
    const linkedVersion = {
      ...internalReviewDeliverable.versions[0],
      file_name: "Campaign review board",
      file_size: "40",
      mime_type: "text/uri-list",
      storage_type: "external",
      external_url: "https://review.example.com/campaign-v1",
      client_submitted_at: "2026-07-20T09:00:00.000Z"
    };
    apiRequestMock.mockResolvedValue({
      data: {
        id: "project-1",
        name: "Portal Campaign",
        client_name: "Portal Client",
        client_role: "reviewer",
        description: "Campaign review",
        current_phase: "production",
        deadline: "2026-09-01",
        activity: [],
        deliverables: [{ ...internalReviewDeliverable, status: "in_review", versions: [linkedVersion] }]
      }
    });
    renderWithClient(
      <MemoryRouter initialEntries={["/portal/projects/project-1"]}>
        <Routes><Route path="/portal/projects/:projectId" element={<ClientProjectDetailPage />} /></Routes>
      </MemoryRouter>
    );

    const link = await screen.findByRole("link", { name: "Open Campaign review board on External link" });
    expect(link).toHaveAttribute("href", "https://review.example.com/campaign-v1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText("Open the submitted work in a new tab")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
  });

  it("gives a client review controls only while the submitted version is awaiting review", async () => {
    apiRequestMock.mockResolvedValue({
      data: {
        id: "project-1",
        name: "Portal Campaign",
        client_name: "Portal Client",
        client_role: "reviewer",
        description: "Campaign review",
        current_phase: "production",
        deadline: "2026-09-01",
        activity: [],
        deliverables: [{
          ...internalReviewDeliverable,
          status: "in_review",
          versions: [{
            ...internalReviewDeliverable.versions[0],
            client_submitted_at: "2026-07-20T09:00:00.000Z"
          }]
        }]
      }
    });
    const user = userEvent.setup();
    renderWithClient(
      <MemoryRouter initialEntries={["/portal/projects/project-1"]}>
        <Routes><Route path="/portal/projects/:projectId" element={<ClientProjectDetailPage />} /></Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText("Awaiting your review")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.getByRole("dialog", { name: /review campaign film/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Request changes" }));
    expect(screen.getByText("Comment (required)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit review" })).toBeDisabled();
  });
});
