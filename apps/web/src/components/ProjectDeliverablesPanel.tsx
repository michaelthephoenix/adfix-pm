import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  EyeOff,
  FileArchive,
  FileAudio,
  FileCheck2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  FileVideo,
  Link2,
  MessageSquareText,
  Plus,
  RotateCcw,
  Send,
  ShieldCheck,
  UploadCloud,
  UsersRound,
  XCircle
} from "lucide-react";
import { useRef, useState } from "react";
import { apiRequest, apiUpload, ApiError } from "../lib/api";
import { useAuth } from "../state/auth";
import { useUI } from "../state/ui";
import { EmptyState, ErrorState, LoadingState } from "./States";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { FilePreviewDialog, type PreviewFile } from "./FilePreviewDialog";
import { DeliverableExternalLink, isExternalDeliverable, type ExternalStorageType } from "./DeliverableExternalLink";
import { MAX_UPLOAD_BYTES, UploadSizeAlert } from "./UploadSizeAlert";
import { DeliverableVersionHistory } from "./DeliverableVersionHistory";

type Decision = "approved" | "changes_requested";
type DeliverableStatus =
  | "draft"
  | "internal_review"
  | "internal_changes_requested"
  | "internal_approved"
  | "in_review"
  | "changes_requested"
  | "approved";
type Review = { id: string; decision: Decision; comment: string | null; reviewer_name: string; created_at: string };
type Message = { id: string; author_name: string; author_type: "staff" | "client"; body: string; created_at: string };
type Version = {
  id: string;
  file_id: string;
  file_name: string;
  file_size: string;
  mime_type: string;
  storage_type: "local" | "s3" | ExternalStorageType;
  external_url: string | null;
  version_number: number;
  submission_note: string | null;
  submitted_by_name: string;
  submitted_at: string;
  client_submitted_by: string | null;
  client_submitted_by_name: string | null;
  client_submitted_at: string | null;
  client_withdrawn_by: string | null;
  client_withdrawn_by_name: string | null;
  client_withdrawn_at: string | null;
  reviews: Review[];
  internal_reviews: Review[];
  messages: Message[];
  feedback_forward_count: number;
};
type TaskRef = { id: string; title: string; status: string };
type Deliverable = { id: string; title: string; description: string | null; status: DeliverableStatus; tasks: TaskRef[]; versions: Version[] };
type TasksResponse = { data: TaskRef[] };
type DeliverablesResponse = { data: Deliverable[]; meta: { canSupervise: boolean } };

const statusCopy: Record<DeliverableStatus, { label: string; help: string; step: number }> = {
  draft: { label: "Draft", help: "Waiting for the team to submit a file or review link.", step: 0 },
  internal_review: { label: "Internal review", help: "A supervisor needs to review this version.", step: 1 },
  internal_changes_requested: { label: "Internal changes", help: "The team needs to upload a revised version.", step: 1 },
  internal_approved: { label: "Approved — not sent", help: "Internal approval is complete. A project owner or manager must still submit this to the client.", step: 2 },
  in_review: { label: "Client review", help: "The client has been notified and can review this version.", step: 3 },
  changes_requested: { label: "Client changes", help: "A supervisor can reply or route edited feedback to the team.", step: 3 },
  approved: { label: "Client approved", help: "The client approved the current version.", step: 4 }
};

function readableError(caught: unknown, fallback: string) {
  return caught instanceof ApiError ? caught.message : fallback;
}

function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatSelectedFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function selectedFileType(file: File) {
  const extension = file.name.split(".").pop()?.toUpperCase();
  if (file.type.startsWith("image/")) return { label: extension || "Image", icon: <FileImage size={21} /> };
  if (file.type.startsWith("video/")) return { label: extension || "Video", icon: <FileVideo size={21} /> };
  if (file.type.startsWith("audio/")) return { label: extension || "Audio", icon: <FileAudio size={21} /> };
  if (/zip|compressed|archive|rar|7z/.test(file.type) || ["ZIP", "RAR", "7Z"].includes(extension ?? "")) return { label: extension || "Archive", icon: <FileArchive size={21} /> };
  if (/spreadsheet|excel|csv/.test(file.type) || ["XLS", "XLSX", "CSV"].includes(extension ?? "")) return { label: extension || "Spreadsheet", icon: <FileSpreadsheet size={21} /> };
  if (/pdf|text|word|document|presentation/.test(file.type) || ["PDF", "TXT", "DOC", "DOCX", "PPT", "PPTX"].includes(extension ?? "")) return { label: extension || "Document", icon: <FileText size={21} /> };
  return { label: extension || "File", icon: <FileType2 size={21} /> };
}

function CircularUploadProgress({ value, fileName }: { value: number; fileName: string }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(100, value));
  return (
    <span className="circular-upload-progress" role="progressbar" aria-label={`Uploading ${fileName}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle className="progress-track" cx="22" cy="22" r={radius} />
        <circle className="progress-value" cx="22" cy="22" r={radius} style={{ strokeDasharray: circumference, strokeDashoffset: circumference - (circumference * progress) / 100 }} />
      </svg>
      <span>{progress}%</span>
    </span>
  );
}

function ApprovalPath({ status }: { status: DeliverableStatus }) {
  const activeStep = statusCopy[status].step;
  const steps = ["Team submission", "Internal approval", "Submit to client", "Client review"];
  return (
    <ol className="approval-path" aria-label="Deliverable approval progress">
      {steps.map((step, index) => (
        <li key={step} className={index < activeStep || status === "approved" ? "complete" : index === activeStep ? "active" : ""}>
          <span>{index < activeStep || status === "approved" ? <CheckCircle2 size={13} /> : index + 1}</span>{step}
        </li>
      ))}
    </ol>
  );
}

export function ProjectDeliverablesPanel({
  projectId,
  canWrite,
  canSupervise,
  deliveryLocked
}: {
  projectId: string;
  canWrite: boolean;
  canSupervise: boolean;
  deliveryLocked: boolean;
}) {
  const { accessToken, user } = useAuth();
  const ui = useUI();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [selectedVersionFile, setSelectedVersionFile] = useState<File | null>(null);
  const [oversizedVersionFile, setOversizedVersionFile] = useState<{ name: string; size: number } | null>(null);
  const [versionSourceMode, setVersionSourceMode] = useState<"upload" | "link">("upload");
  const [linkedVersionName, setLinkedVersionName] = useState("");
  const [linkedVersionUrl, setLinkedVersionUrl] = useState("");
  const [linkedVersionStorage, setLinkedVersionStorage] = useState<ExternalStorageType>("external");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submissionNote, setSubmissionNote] = useState("");
  const [versionIdempotencyKey, setVersionIdempotencyKey] = useState(newIdempotencyKey);
  const [reviewing, setReviewing] = useState<{ deliverable: Deliverable; version: Version } | null>(null);
  const [decision, setDecision] = useState<Decision>("approved");
  const [reviewComment, setReviewComment] = useState("");
  const [routing, setRouting] = useState<{ deliverable: Deliverable; version: Version; review: Review } | null>(null);
  const [routeTaskIds, setRouteTaskIds] = useState<string[]>([]);
  const [routeBody, setRouteBody] = useState("");
  const [replyVersionId, setReplyVersionId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actionIdempotencyKeys = useRef(new Map<string, string>());

  const actionIdempotencyKey = (scope: string) => {
    const existing = actionIdempotencyKeys.current.get(scope);
    if (existing) return existing;
    const created = newIdempotencyKey();
    actionIdempotencyKeys.current.set(scope, created);
    return created;
  };

  const clearActionIdempotencyKey = (scope: string) => {
    actionIdempotencyKeys.current.delete(scope);
  };

  const resetVersionSubmission = () => {
    setUploadingFor(null);
    setSelectedVersionFile(null);
    setOversizedVersionFile(null);
    setVersionSourceMode("upload");
    setLinkedVersionName("");
    setLinkedVersionUrl("");
    setLinkedVersionStorage("external");
    setUploadProgress(0);
    setSubmissionNote("");
    setVersionIdempotencyKey(newIdempotencyKey());
    setError(null);
  };

  const resetCreateDeliverable = () => {
    setCreateOpen(false);
    setTitle("");
    setDescription("");
    setSelectedTaskIds([]);
    setError(null);
  };

  const resetInternalReview = () => {
    setReviewing(null);
    setDecision("approved");
    setReviewComment("");
    setError(null);
  };

  const resetFeedbackRouting = () => {
    setRouting(null);
    setRouteTaskIds([]);
    setRouteBody("");
    setError(null);
  };

  const confirmDiscard = async (dirty: boolean, reset: () => void) => {
    if (!dirty) {
      reset();
      return;
    }
    const confirmed = await ui.confirm({
      title: "Discard unsaved changes?",
      message: "The information entered in this dialog has not been saved.",
      confirmLabel: "Discard changes",
      cancelLabel: "Keep editing",
      tone: "warning"
    });
    if (confirmed) reset();
  };

  const query = useQuery({
    queryKey: ["project-deliverables", projectId],
    queryFn: () => apiRequest<DeliverablesResponse>(`/deliverables/project/${projectId}`, { accessToken: accessToken ?? undefined }),
    enabled: Boolean(projectId && accessToken)
  });
  const tasksQuery = useQuery({
    queryKey: ["project-tasks", projectId, "deliverable-picker"],
    queryFn: () => apiRequest<TasksResponse>(`/tasks?projectId=${projectId}&page=1&pageSize=100&sortBy=updatedAt&sortOrder=desc`, { accessToken: accessToken ?? undefined }),
    enabled: Boolean(projectId && accessToken && (createOpen || routing))
  });
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["project-deliverables", projectId] }),
    queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] }),
    queryClient.invalidateQueries({ queryKey: ["project-detail", projectId] }),
    queryClient.invalidateQueries({ queryKey: ["notifications"] })
  ]);

  const submitVersionSafely = async (deliverableId: string, fileId: string) => {
    const submit = () => apiRequest(`/deliverables/${deliverableId}/versions`, {
      method: "POST",
      accessToken: accessToken ?? undefined,
      idempotencyKey: versionIdempotencyKey,
      body: { fileId, submissionNote: submissionNote.trim() || null }
    });
    const statusIsUncertain = (caught: unknown) => !(caught instanceof ApiError) || (
        caught.status >= 500
        || caught.status === 408
        || caught.code === "IDEMPOTENCY_IN_PROGRESS"
        || caught.code === "API_UNREACHABLE"
        || caught.code === "REQUEST_TIMEOUT"
      );

    try {
      return await submit();
    } catch (firstError) {
      if (!statusIsUncertain(firstError)) throw firstError;
      await new Promise((resolve) => globalThis.setTimeout(resolve, 250));
      try {
        return await submit();
      } catch (retryError) {
        if (!statusIsUncertain(retryError)) throw retryError;
        throw new ApiError(
          "The file was uploaded, but submission status could not be confirmed. Refresh the deliverable before retrying.",
          409,
          "SUBMISSION_STATUS_UNKNOWN"
        );
      }
    }
  };

  const createMutation = useMutation({
    mutationFn: () => apiRequest("/deliverables", {
      method: "POST",
      accessToken: accessToken ?? undefined,
      body: { projectId, title: title.trim(), description: description.trim() || null, taskIds: selectedTaskIds }
    }),
    onSuccess: async () => {
      resetCreateDeliverable();
      await refresh();
    },
    onError: (caught) => setError(readableError(caught, "Could not create deliverable."))
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ deliverableId, file }: { deliverableId: string; file: File }) => {
      if (file.size > MAX_UPLOAD_BYTES) throw new ApiError("Files must be 50 MB or smaller.", 400);
      const formData = new FormData();
      formData.set("projectId", projectId);
      formData.set("fileType", "deliverable");
      formData.set("file", file);
      const uploaded = await apiUpload<{ data: { id: string } }>("/files/upload-binary", formData, accessToken ?? undefined, {
        onProgress: setUploadProgress
      });
      try {
        return await submitVersionSafely(deliverableId, uploaded.data.id);
      } catch (error) {
        if (error instanceof ApiError && error.code === "SUBMISSION_STATUS_UNKNOWN") throw error;
        const removed = await apiRequest<void>(`/files/${uploaded.data.id}`, {
          method: "DELETE",
          accessToken: accessToken ?? undefined
        }).then(() => true).catch(() => false);
        if (!removed) {
          throw new ApiError(
            "The upload finished, but submission status could not be confirmed. Refresh the deliverable before retrying.",
            409,
            "SUBMISSION_STATUS_UNKNOWN"
          );
        }
        throw error;
      }
    },
    onMutate: () => setUploadProgress(0),
    onSuccess: async () => {
      resetVersionSubmission(); setError(null);
      ui.success("Version sent to project supervisors for internal approval.");
      await refresh();
    },
    onError: (caught) => {
      setUploadProgress(0);
      setError(readableError(caught, "Could not submit this version."));
    }
  });

  const linkVersionMutation = useMutation({
    mutationFn: async ({ deliverableId }: { deliverableId: string }) => {
      const name = linkedVersionName.trim();
      const url = linkedVersionUrl.trim();
      const linked = await apiRequest<{ data: { id: string } }>("/files/link", {
        method: "POST",
        accessToken: accessToken ?? undefined,
        body: {
          projectId,
          fileName: name,
          fileType: "deliverable",
          storageType: linkedVersionStorage,
          externalUrl: url,
          mimeType: "text/uri-list",
          fileSize: new TextEncoder().encode(url).length
        }
      });
      try {
        return await submitVersionSafely(deliverableId, linked.data.id);
      } catch (error) {
        if (error instanceof ApiError && error.code === "SUBMISSION_STATUS_UNKNOWN") throw error;
        const removed = await apiRequest<void>(`/files/${linked.data.id}`, {
          method: "DELETE",
          accessToken: accessToken ?? undefined
        }).then(() => true).catch(() => false);
        if (!removed) {
          throw new ApiError(
            "The link was saved, but submission status could not be confirmed. Refresh the deliverable before retrying.",
            409,
            "SUBMISSION_STATUS_UNKNOWN"
          );
        }
        throw error;
      }
    },
    onSuccess: async () => {
      resetVersionSubmission(); setError(null);
      ui.success("Linked work sent to project supervisors for internal approval.");
      await refresh();
    },
    onError: (caught) => setError(readableError(caught, "Could not submit this link."))
  });

  const internalReviewMutation = useMutation({
    mutationFn: () => apiRequest(`/deliverables/versions/${reviewing?.version.id}/internal-review`, {
      method: "POST",
      accessToken: accessToken ?? undefined,
      idempotencyKey: actionIdempotencyKey(`internal-review:${reviewing?.version.id}`),
      body: { decision, comment: reviewComment.trim() || null }
    }),
    onSuccess: async () => {
      if (reviewing?.version.id) clearActionIdempotencyKey(`internal-review:${reviewing.version.id}`);
      resetInternalReview();
      ui.success(decision === "approved" ? "Internally approved. It is still private until you submit it to the client." : "Changes returned to the team.");
      await refresh();
    },
    onError: (caught) => setError(readableError(caught, "Could not record the internal review."))
  });

  const submitClientMutation = useMutation({
    mutationFn: (versionId: string) => apiRequest(`/deliverables/versions/${versionId}/submit-client`, {
      method: "POST",
      accessToken: accessToken ?? undefined,
      idempotencyKey: actionIdempotencyKey(`submit-client:${versionId}`)
    }),
    onSuccess: async (_result, versionId) => { clearActionIdempotencyKey(`submit-client:${versionId}`); ui.success("Client reviewers have been notified."); await refresh(); },
    onError: (caught) => setError(readableError(caught, "Could not submit this version to the client."))
  });

  const withdrawClientMutation = useMutation({
    mutationFn: (versionId: string) => apiRequest(`/deliverables/versions/${versionId}/withdraw-client`, {
      method: "POST",
      accessToken: accessToken ?? undefined,
      idempotencyKey: actionIdempotencyKey(`withdraw-client:${versionId}`)
    }),
    onSuccess: async (_result, versionId) => {
      clearActionIdempotencyKey(`withdraw-client:${versionId}`);
      setError(null);
      ui.success("The deliverable is private again. Client reviewers and the project team have been notified.");
      await refresh();
    },
    onError: (caught) => setError(readableError(caught, "Could not pull this version back from client review."))
  });

  const routeMutation = useMutation({
    mutationFn: () => apiRequest(`/deliverables/versions/${routing?.version.id}/forward-feedback`, {
      method: "POST",
      accessToken: accessToken ?? undefined,
      idempotencyKey: actionIdempotencyKey(`forward-feedback:${routing?.version.id}:${routing?.review.id}`),
      body: { sourceReviewId: routing?.review.id, taskIds: routeTaskIds, body: routeBody.trim() }
    }),
    onSuccess: async () => {
      if (routing) clearActionIdempotencyKey(`forward-feedback:${routing.version.id}:${routing.review.id}`);
      resetFeedbackRouting();
      ui.success("Instructions added to the selected tasks and assignees notified.");
      await refresh();
    },
    onError: (caught) => setError(readableError(caught, "Could not route this feedback."))
  });

  const replyMutation = useMutation({
    mutationFn: () => apiRequest(`/deliverables/versions/${replyVersionId}/messages`, {
      method: "POST",
      accessToken: accessToken ?? undefined,
      idempotencyKey: actionIdempotencyKey(`staff-message:${replyVersionId}`),
      body: { body: replyBody.trim() }
    }),
    onSuccess: async () => {
      if (replyVersionId) clearActionIdempotencyKey(`staff-message:${replyVersionId}`);
      setReplyVersionId(null); setReplyBody(""); setError(null);
      ui.success("Reply sent to client reviewers.");
      await refresh();
    },
    onError: (caught) => setError(readableError(caught, "Could not send this reply."))
  });

  const allTasks = tasksQuery.data?.data ?? [];
  const completedTasks = allTasks.filter((task) => task.status === "completed");
  const selectedDeliverable = query.data?.data.find((deliverable) => deliverable.id === uploadingFor);
  const versionSubmissionPending = uploadMutation.isPending || linkVersionMutation.isPending;
  const versionSubmissionReady = versionSourceMode === "upload"
    ? Boolean(selectedVersionFile)
    : Boolean(linkedVersionName.trim() && linkedVersionUrl.trim());
  const createDeliverableDirty = Boolean(title.trim() || description.trim() || selectedTaskIds.length);
  const versionSubmissionDirty = Boolean(
    selectedVersionFile
    || linkedVersionName.trim()
    || linkedVersionUrl.trim()
    || submissionNote.trim()
  );
  const internalReviewDirty = Boolean(reviewComment.trim() || decision !== "approved");
  const feedbackRoutingDirty = Boolean(routeBody.trim() || routeTaskIds.length);

  if (query.isLoading) return <LoadingState message="Loading deliverables..." />;
  if (query.isError) return <ErrorState message="Could not load deliverables." onRetry={() => void query.refetch()} />;

  return (
    <div className="deliverables-pane">
      <div className="section-action-bar">
        <div><p className="eyebrow">Approval workflow</p><h2>Deliverables</h2><p className="muted">Team submission, internal approval, then client review.</p></div>
        {canWrite && !deliveryLocked ? <Button variant="primary" icon={<Plus size={16} />} onClick={() => { setError(null); setCreateOpen(true); }}>New deliverable</Button> : null}
      </div>
      {deliveryLocked ? <div className="delivery-notice"><CheckCircle2 size={20} /><div><strong>Delivery is complete</strong><p>Approval and discussion are closed. Files and history remain available.</p></div></div> : null}
      {error && !createOpen && !uploadingFor && !reviewing && !routing && !replyVersionId ? <p className="error-text board-error" role="alert">{error}</p> : null}

      {!query.data?.data.length ? <EmptyState message="Create a deliverable and connect it to the tasks that produced the work." /> : (
        <div className="deliverable-grid">
          {query.data.data.map((deliverable) => {
            const latest = deliverable.versions[0];
            const latestClientReview = latest?.reviews[0];
            const canUploadRevision = canWrite && !deliveryLocked && (
              deliverable.status === "draft" ||
              deliverable.status === "internal_changes_requested" ||
              (deliverable.status === "changes_requested" && (canSupervise || (latest?.feedback_forward_count ?? 0) > 0))
            );
            return (
              <article className="card deliverable-card deliverable-workflow-card" key={deliverable.id}>
                <div className="deliverable-heading">
                  <div className="deliverable-icon"><FileCheck2 size={20} /></div>
                  <div><h3>{deliverable.title}</h3>{deliverable.description ? <p className="muted">{deliverable.description}</p> : null}</div>
                  <span className={`review-status status-${deliverable.status}`}>{statusCopy[deliverable.status].label}</span>
                </div>
                <ApprovalPath status={deliverable.status} />
                <p className="workflow-help">{statusCopy[deliverable.status].help}</p>
                {deliverable.status === "internal_approved" ? <div className="client-visibility-callout"><EyeOff size={17} /><div><strong>Not visible to the client yet</strong><p>A project owner or manager must explicitly submit this approved version.</p></div></div> : null}
                {deliverable.tasks.length ? <div className="linked-task-list"><span>Produced from</span>{deliverable.tasks.map((task) => <span className="linked-task-chip" key={task.id}>{task.title}</span>)}</div> : null}
                {latest ? (
                  <div className="deliverable-version">
                    <div><strong>Version {latest.version_number}</strong><p className="muted">{isExternalDeliverable(latest) ? "Linked deliverable" : `${latest.file_name} · ${Math.ceil(Number(latest.file_size) / 1024)} KB`}</p><p className="version-byline">Submitted internally by {latest.submitted_by_name}</p>{latest.submission_note ? <p>{latest.submission_note}</p> : null}</div>
                  </div>
                ) : <p className="muted">No version uploaded yet.</p>}

                {latest?.internal_reviews.length ? <section className="approval-history"><h4><ShieldCheck size={14} /> Internal review</h4>{latest.internal_reviews.map((review) => <div className="review-history-item" key={review.id}>{review.decision === "approved" ? <CheckCircle2 size={16} /> : <XCircle size={16} />}<div><strong>{review.decision === "approved" ? "Approved" : "Changes requested"}</strong> by {review.reviewer_name}{review.comment ? <p>{review.comment}</p> : null}</div></div>)}</section> : null}

                {canSupervise && latest && (latest.reviews.length > 0 || latest.messages.length > 0) ? (
                  <section className="client-feedback-panel">
                    <h4><MessageSquareText size={14} /> Client conversation</h4>
                    {latest.reviews.map((review) => <div className="conversation-entry client-entry" key={review.id}><div><strong>{review.reviewer_name}</strong><span>{review.decision === "approved" ? "Approved this version" : "Requested changes"}</span></div>{review.comment ? <p>{review.comment}</p> : null}</div>)}
                    {latest.messages.map((message) => <div className={`conversation-entry ${message.author_type}-entry`} key={message.id}><div><strong>{message.author_name}</strong><span>{message.author_type === "client" ? "Client" : "Project team"}</span></div><p>{message.body}</p></div>)}
                    {!deliveryLocked && replyVersionId === latest.id ? <form className="reply-composer" onSubmit={(event) => { event.preventDefault(); if (replyBody.trim()) replyMutation.mutate(); }}><textarea autoFocus value={replyBody} onChange={(event) => { setReplyBody(event.target.value); clearActionIdempotencyKey(`staff-message:${latest.id}`); }} placeholder="Reply to the client reviewers" rows={3} /><div className="inline-actions"><Button variant="ghost" size="sm" onClick={() => { setReplyVersionId(null); setReplyBody(""); clearActionIdempotencyKey(`staff-message:${latest.id}`); }}>Cancel</Button><Button variant="primary" size="sm" type="submit" icon={<Send size={14} />} disabled={!replyBody.trim() || replyMutation.isPending}>Send reply</Button></div></form> : null}
                  </section>
                ) : null}

                <DeliverableVersionHistory
                  versions={deliverable.versions}
                  accessToken={accessToken ?? undefined}
                  onPreview={setPreviewFile}
                />

                {!deliveryLocked ? <div className="deliverable-card-actions workflow-actions">
                  {canUploadRevision ? <Button variant="secondary" size="sm" icon={<Send size={15} />} onClick={() => { resetVersionSubmission(); setUploadingFor(deliverable.id); }}>{latest ? "Submit revised version" : "Submit first version"}</Button> : null}
                  {canSupervise && latest && deliverable.status === "internal_review" ? <Button variant="primary" size="sm" icon={<ShieldCheck size={15} />} onClick={() => { setError(null); setReviewing({ deliverable, version: latest }); setDecision("approved"); setReviewComment(""); }}>Review internally</Button> : null}
                  {canSupervise && latest && deliverable.status === "internal_approved" ? <Button variant="primary" size="sm" icon={<Send size={15} />} disabled={submitClientMutation.isPending} onClick={async () => {
                    const confirmed = await ui.confirm({ title: "Make this visible to the client?", message: "This is a separate step from internal approval. Client reviewers will be notified and will be able to view, approve, or request changes.", confirmLabel: "Submit and notify client", cancelLabel: "Keep private" });
                    if (confirmed) submitClientMutation.mutate(latest.id);
                  }}>Submit to client for review</Button> : null}
                  {canSupervise && latest && deliverable.status === "in_review" && latest.client_submitted_by === user?.id ? <Button variant="secondary" size="sm" icon={<RotateCcw size={15} />} disabled={withdrawClientMutation.isPending} onClick={async () => {
                    const confirmed = await ui.confirm({
                      title: "Pull this back from client review?",
                      message: "The client will lose access to this version and be notified. Internal approval stays intact, so you can submit it again when the issue is resolved.",
                      confirmLabel: "Pull back and notify",
                      cancelLabel: "Keep with client",
                      tone: "warning"
                    });
                    if (confirmed) withdrawClientMutation.mutate(latest.id);
                  }}>{withdrawClientMutation.isPending ? "Pulling back…" : "Pull back from client review"}</Button> : null}
                  {canSupervise && latest?.client_submitted_at ? <Button variant="ghost" size="sm" icon={<MessageSquareText size={15} />} onClick={() => { setError(null); setReplyVersionId(replyVersionId === latest.id ? null : latest.id); }}>Reply to client</Button> : null}
                  {canSupervise && latestClientReview?.decision === "changes_requested" ? <Button variant="secondary" size="sm" icon={<UsersRound size={15} />} onClick={() => {
                    setError(null);
                    setRouting({ deliverable, version: latest, review: latestClientReview });
                    setRouteTaskIds(deliverable.tasks.map((task) => task.id));
                    setRouteBody(latestClientReview.comment ?? "");
                  }}>Route feedback to team</Button> : null}
                </div> : null}
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={(open) => { if (open) setCreateOpen(true); else void confirmDiscard(createDeliverableDirty, resetCreateDeliverable); }} title="Create a deliverable" description="Connect the output to the tasks that produced it." size="lg" footer={<div className="inline-actions"><Button variant="ghost" onClick={() => void confirmDiscard(createDeliverableDirty, resetCreateDeliverable)}>Cancel</Button><Button variant="primary" type="submit" form="create-deliverable-form" icon={<Plus size={16} />} disabled={!title.trim() || createMutation.isPending}>Create deliverable</Button></div>}>
        <form id="create-deliverable-form" className="modal-form" onSubmit={(event) => { event.preventDefault(); if (title.trim()) createMutation.mutate(); }}>
          <label className="field"><span>Deliverable title</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Campaign launch film" required /></label>
          <label className="field"><span>Internal description <small>Optional</small></span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What is being prepared and reviewed?" rows={3} /></label>
          <fieldset className="task-link-picker"><legend>Source tasks <small>Optional</small></legend><p>Completed tasks appear first. Linking them makes it easy to route client feedback back to the right people.</p>{tasksQuery.isLoading ? <p className="muted">Loading tasks...</p> : allTasks.length ? <div className="task-link-options">{[...completedTasks, ...allTasks.filter((task) => task.status !== "completed")].map((task) => <label key={task.id}><input type="checkbox" checked={selectedTaskIds.includes(task.id)} onChange={() => setSelectedTaskIds((current) => current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id])} /><span><strong>{task.title}</strong><small>{task.status.replaceAll("_", " ")}</small></span></label>)}</div> : <p className="muted">No tasks are available yet.</p>}</fieldset>
          {error ? <p className="error-text" role="alert">{error}</p> : null}
        </form>
      </Dialog>

      <Dialog
        open={Boolean(uploadingFor)}
        onOpenChange={(open) => {
          if (!open && !versionSubmissionPending) void confirmDiscard(versionSubmissionDirty, resetVersionSubmission);
        }}
        title={selectedDeliverable?.versions.length ? "Submit a revised version" : "Submit the first version"}
        description="This version goes to project supervisors first. Clients cannot see it yet."
        footer={<div className="inline-actions"><Button variant="ghost" onClick={() => void confirmDiscard(versionSubmissionDirty, resetVersionSubmission)} disabled={versionSubmissionPending}>Cancel</Button><Button variant="primary" type="submit" form="upload-deliverable-version-form" icon={<Send size={16} />} disabled={!versionSubmissionReady || versionSubmissionPending}>{uploadMutation.isPending ? uploadProgress < 100 ? `Uploading ${uploadProgress}%` : "Finalizing submission…" : linkVersionMutation.isPending ? "Submitting link…" : "Send for internal approval"}</Button></div>}
      >
        <form id="upload-deliverable-version-form" className="modal-form" onSubmit={(event) => {
          event.preventDefault();
          if (!uploadingFor) return;
          if (versionSourceMode === "upload" && selectedVersionFile) uploadMutation.mutate({ deliverableId: uploadingFor, file: selectedVersionFile });
          if (versionSourceMode === "link" && linkedVersionName.trim() && linkedVersionUrl.trim()) linkVersionMutation.mutate({ deliverableId: uploadingFor });
        }}>
          <div className="workflow-stage-callout"><ShieldCheck size={18} /><div><strong>Internal review first</strong><p>A project owner or manager will approve this before it reaches the client.</p></div></div>
          <div className="version-source-switch" role="tablist" aria-label="Choose how to submit the deliverable">
            <button type="button" role="tab" aria-selected={versionSourceMode === "upload"} className={versionSourceMode === "upload" ? "active" : ""} disabled={versionSubmissionPending} onClick={() => { setVersionSourceMode("upload"); setVersionIdempotencyKey(newIdempotencyKey()); }}><UploadCloud size={17} /><span><strong>Upload a file</strong><small>Up to 50 MB</small></span></button>
            <button type="button" role="tab" aria-selected={versionSourceMode === "link"} className={versionSourceMode === "link" ? "active" : ""} disabled={versionSubmissionPending} onClick={() => { setVersionSourceMode("link"); setVersionIdempotencyKey(newIdempotencyKey()); }}><Link2 size={17} /><span><strong>Share a link</strong><small>Drive, Dropbox, Frame.io, and more</small></span></button>
          </div>
          {versionSourceMode === "upload" ? <div className="field version-file-field">
            <span>Version file</span>
            <label className={`version-file-picker ${selectedVersionFile ? "has-file" : ""} ${uploadMutation.isPending ? "is-uploading" : ""}`}>
              <input className="sr-only" name="versionFile" type="file" aria-label="Version file" aria-describedby={oversizedVersionFile ? "deliverable-file-size-error" : undefined} disabled={versionSubmissionPending} onChange={(event) => {
                const nextFile = event.target.files?.[0] ?? null;
                setVersionIdempotencyKey(newIdempotencyKey());
                setUploadProgress(0);
                setError(null);
                if (nextFile && nextFile.size > MAX_UPLOAD_BYTES) {
                  setSelectedVersionFile(null);
                  setOversizedVersionFile({ name: nextFile.name, size: nextFile.size });
                  event.currentTarget.value = "";
                  return;
                }
                setOversizedVersionFile(null);
                setSelectedVersionFile(nextFile);
              }} />
              <span className="version-file-icon">{uploadMutation.isPending && selectedVersionFile ? <CircularUploadProgress value={uploadProgress} fileName={selectedVersionFile.name} /> : selectedVersionFile ? selectedFileType(selectedVersionFile).icon : <UploadCloud size={21} />}</span>
              <span className="version-file-copy"><strong>{selectedVersionFile?.name ?? "Select a version file"}</strong><small>{selectedVersionFile ? `${selectedFileType(selectedVersionFile).label} · ${formatSelectedFileSize(selectedVersionFile.size)}` : "PDF, images, video, Office files, ZIP, or text up to 50 MB"}</small></span>
              <span className="version-file-action">{uploadMutation.isPending ? "Uploading" : selectedVersionFile ? "Replace" : "Select"}</span>
            </label>
            {oversizedVersionFile ? <UploadSizeAlert id="deliverable-file-size-error" fileName={oversizedVersionFile.name} fileSize={oversizedVersionFile.size} suggestLink /> : null}
            {selectedVersionFile && !uploadMutation.isPending ? <button type="button" className="remove-selected-file" onClick={() => { setSelectedVersionFile(null); setUploadProgress(0); setVersionIdempotencyKey(newIdempotencyKey()); }}>Remove file</button> : null}
          </div> : <div className="linked-version-fields">
            <label className="field"><span>Deliverable name</span><input autoFocus value={linkedVersionName} onChange={(event) => { setLinkedVersionName(event.target.value); setVersionIdempotencyKey(newIdempotencyKey()); }} placeholder="e.g. Campaign film review" required /></label>
            <label className="field"><span>Review link</span><input type="url" value={linkedVersionUrl} onChange={(event) => { setLinkedVersionUrl(event.target.value); setVersionIdempotencyKey(newIdempotencyKey()); }} placeholder="https://..." required /></label>
            <label className="field"><span>Platform</span><select value={linkedVersionStorage} onChange={(event) => { setLinkedVersionStorage(event.target.value as ExternalStorageType); setVersionIdempotencyKey(newIdempotencyKey()); }}>
              <option value="external">Other web link</option>
              <option value="google_drive">Google Drive</option>
              <option value="dropbox">Dropbox</option>
              <option value="onedrive">OneDrive</option>
            </select></label>
            {linkedVersionUrl.trim() ? <DeliverableExternalLink href={linkedVersionUrl.trim()} fileName={linkedVersionName.trim() || "Linked deliverable"} storageType={linkedVersionStorage} /> : null}
          </div>}
          <label className="field"><span>Note for the supervisor <small>Optional</small></span><textarea value={submissionNote} onChange={(event) => { setSubmissionNote(event.target.value); setVersionIdempotencyKey(newIdempotencyKey()); }} placeholder="What changed, and what needs attention?" rows={4} disabled={versionSubmissionPending} /></label>
          {error ? <p className="error-text" role="alert">{error}</p> : null}
        </form>
      </Dialog>

      <Dialog open={Boolean(reviewing)} onOpenChange={(open) => { if (!open) void confirmDiscard(internalReviewDirty, resetInternalReview); }} title={`Internal review: ${reviewing?.deliverable.title ?? "deliverable"}`} description="Approve this version for client submission, or return clear changes to the team." footer={<div className="inline-actions"><Button variant="ghost" onClick={() => void confirmDiscard(internalReviewDirty, resetInternalReview)}>Cancel</Button><Button variant="primary" type="submit" form="internal-review-form" icon={decision === "approved" ? <CheckCircle2 size={16} /> : <XCircle size={16} />} disabled={internalReviewMutation.isPending || (decision === "changes_requested" && !reviewComment.trim())}>{internalReviewMutation.isPending ? "Recording…" : decision === "approved" ? "Confirm approval" : "Return to team"}</Button></div>}>
        <form id="internal-review-form" className="modal-form" onSubmit={(event) => { event.preventDefault(); internalReviewMutation.mutate(); }}>
          <div className="review-decision-picker">
            <div className="review-choice-heading"><strong>Choose a decision</strong><span>Press one of the actions below</span></div>
            <div className="review-choice" role="group" aria-label="Internal review decision">
              <button type="button" aria-label="Approve internally" aria-pressed={decision === "approved"} className={decision === "approved" ? "review-option selected" : "review-option"} onClick={() => { setDecision("approved"); if (reviewing) clearActionIdempotencyKey(`internal-review:${reviewing.version.id}`); }}>
                <span className="review-option-icon"><CheckCircle2 /></span>
                <span className="review-option-copy"><strong>Approve internally</strong><small>Ready for client submission</small></span>
                <span className="review-option-state">{decision === "approved" ? "Selected" : "Select"}</span>
              </button>
              <button type="button" aria-label="Return changes" aria-pressed={decision === "changes_requested"} className={decision === "changes_requested" ? "review-option selected changes" : "review-option changes"} onClick={() => { setDecision("changes_requested"); if (reviewing) clearActionIdempotencyKey(`internal-review:${reviewing.version.id}`); }}>
                <span className="review-option-icon"><XCircle /></span>
                <span className="review-option-copy"><strong>Return changes</strong><small>Send revision notes to the team</small></span>
                <span className="review-option-state">{decision === "changes_requested" ? "Selected" : "Select"}</span>
              </button>
            </div>
          </div>
          <label className="field"><span>Supervisor note {decision === "changes_requested" ? "(required)" : "(optional)"}</span><textarea value={reviewComment} onChange={(event) => { setReviewComment(event.target.value); if (reviewing) clearActionIdempotencyKey(`internal-review:${reviewing.version.id}`); }} placeholder={decision === "changes_requested" ? "Explain exactly what the team should revise" : "Add an internal approval note"} rows={4} /></label>
          {error ? <p className="error-text" role="alert">{error}</p> : null}
        </form>
      </Dialog>

      <Dialog open={Boolean(routing)} onOpenChange={(open) => { if (!open) void confirmDiscard(feedbackRoutingDirty, resetFeedbackRouting); }} title="Route client feedback to the team" description="Edit the client's comment into an actionable internal instruction. The raw client conversation stays with supervisors." size="lg" footer={<div className="inline-actions"><Button variant="ghost" onClick={() => void confirmDiscard(feedbackRoutingDirty, resetFeedbackRouting)}>Cancel</Button><Button variant="primary" type="submit" form="route-feedback-form" icon={<UsersRound size={16} />} disabled={!routeBody.trim() || routeTaskIds.length === 0 || routeMutation.isPending}>Assign feedback</Button></div>}>
        <form id="route-feedback-form" className="modal-form" onSubmit={(event) => { event.preventDefault(); routeMutation.mutate(); }}>
          <div className="client-quote"><span>Client said</span><p>{routing?.review.comment}</p></div>
          <label className="field"><span>Instruction for the team</span><textarea autoFocus value={routeBody} onChange={(event) => { setRouteBody(event.target.value); if (routing) clearActionIdempotencyKey(`forward-feedback:${routing.version.id}:${routing.review.id}`); }} rows={5} required /></label>
          <fieldset className="task-link-picker"><legend>Assign to tasks</legend><div className="task-link-options">{allTasks.map((task) => <label key={task.id}><input type="checkbox" checked={routeTaskIds.includes(task.id)} onChange={() => { setRouteTaskIds((current) => current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id]); if (routing) clearActionIdempotencyKey(`forward-feedback:${routing.version.id}:${routing.review.id}`); }} /><span><strong>{task.title}</strong><small>{task.status.replaceAll("_", " ")}</small></span></label>)}</div></fieldset>
          {error ? <p className="error-text" role="alert">{error}</p> : null}
        </form>
      </Dialog>
      <FilePreviewDialog file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
}
