import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, Eye, FileText, MessageSquareText, Send, XCircle } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { apiDownload, apiRequest, ApiError } from "../lib/api";
import { useAuth } from "../state/auth";
import { useUI } from "../state/ui";
import { FilePreviewDialog, isPreviewableMimeType, type PreviewFile } from "../components/FilePreviewDialog";
import { DeliverableExternalLink, isExternalDeliverable, type ExternalStorageType } from "../components/DeliverableExternalLink";

type Decision = "approved" | "changes_requested";
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
  client_submitted_at: string;
  reviews: Review[];
  messages: Message[];
};
type Deliverable = { id: string; title: string; description: string | null; status: "in_review" | "changes_requested" | "approved"; versions: Version[] };
type PortalProject = {
  id: string;
  name: string;
  client_name: string;
  client_role: "reviewer" | "viewer";
  description: string | null;
  current_phase: string;
  deadline: string;
  deliverables: Deliverable[];
  activity: Array<{ id: string; action: string; created_at: string; user_name: string | null }>;
};

const clientStatusCopy = {
  in_review: "Awaiting your review",
  changes_requested: "Changes requested",
  approved: "Approved"
} as const;

function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ClientProjectDetailPage() {
  const { projectId = "" } = useParams();
  const { accessToken } = useAuth();
  const ui = useUI();
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = useState<{ deliverable: Deliverable; version: Version } | null>(null);
  const [decision, setDecision] = useState<Decision>("approved");
  const [comment, setComment] = useState("");
  const [reviewIdempotencyKey, setReviewIdempotencyKey] = useState(newIdempotencyKey);
  const [messageVersion, setMessageVersion] = useState<Version | null>(null);
  const [messageBody, setMessageBody] = useState("");
  const [messageIdempotencyKey, setMessageIdempotencyKey] = useState(newIdempotencyKey);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["client-portal-project", projectId],
    queryFn: () => apiRequest<{ data: PortalProject }>(`/client-portal/projects/${projectId}`, { accessToken: accessToken ?? undefined }),
    enabled: Boolean(projectId && accessToken)
  });
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["client-portal-project", projectId] }),
    queryClient.invalidateQueries({ queryKey: ["notifications"] })
  ]);
  const reviewMutation = useMutation({
    mutationFn: () => apiRequest(`/client-portal/versions/${reviewing?.version.id}/reviews`, {
      method: "POST",
      accessToken: accessToken ?? undefined,
      idempotencyKey: reviewIdempotencyKey,
      body: { decision, comment: comment.trim() || null }
    }),
    onSuccess: async () => {
      setReviewing(null); setComment(""); setReviewIdempotencyKey(newIdempotencyKey()); setError(null);
      ui.success(decision === "approved" ? "Deliverable approved." : "Your change request was sent to the project supervisor.");
      await refresh();
    },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Could not submit your review.")
  });
  const messageMutation = useMutation({
    mutationFn: () => apiRequest(`/client-portal/versions/${messageVersion?.id}/messages`, {
      method: "POST",
      accessToken: accessToken ?? undefined,
      idempotencyKey: messageIdempotencyKey,
      body: { body: messageBody.trim() }
    }),
    onSuccess: async () => {
      setMessageVersion(null); setMessageBody(""); setMessageIdempotencyKey(newIdempotencyKey()); setError(null);
      ui.success("Your message was sent to the project supervisor.");
      await refresh();
    },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Could not send your message.")
  });

  if (query.isLoading) return <LoadingState message="Loading project..." />;
  if (query.isError || !query.data) return <ErrorState message="Could not load this project." onRetry={() => void query.refetch()} />;

  const project = query.data.data;
  const reviewsLocked = project.current_phase === "delivery";
  const canParticipate = project.client_role === "reviewer" && !reviewsLocked;
  return (
    <section>
      <header className="portal-project-header">
        <div><p className="eyebrow">{project.client_name}</p><h2>{project.name}</h2><p>{project.description}</p></div>
        <div><span className={`phase-pill phase-pill-${project.current_phase}`}>{project.current_phase.replaceAll("_", " ")}</span><p className="muted">Deadline {new Date(project.deadline).toLocaleDateString()}</p></div>
      </header>
      {reviewsLocked ? <div className="delivery-notice"><CheckCircle2 size={20} /><div><strong>Project delivered</strong><p>Reviews and messages are now closed. Final files and history remain available.</p></div></div> : null}
      {project.client_role === "viewer" ? <div className="portal-access-notice"><FileText size={18} /><div><strong>Read-only access</strong><p>You can view shared deliverables. Decisions and messages are reserved for client reviewers.</p></div></div> : null}
      {error ? <p className="error-text board-error">{error}</p> : null}

      <div className="portal-detail-grid">
        <div><div className="section-head"><h3>Ready for review</h3></div>{project.deliverables.length === 0 ? <EmptyState message="Nothing has been submitted to you yet. Internal work stays hidden until the project supervisor approves it." /> : project.deliverables.map((deliverable) => {
          const latest = deliverable.versions[0];
          const canReview = canParticipate && deliverable.status === "in_review";
          return (
            <article className="card deliverable-card client-deliverable-card" key={deliverable.id}>
              <div className="deliverable-heading"><div className="deliverable-icon"><FileText size={20} /></div><div><h3>{deliverable.title}</h3>{deliverable.description ? <p className="muted">{deliverable.description}</p> : null}</div><span className={`review-status status-${deliverable.status}`}>{clientStatusCopy[deliverable.status]}</span></div>
              {latest ? <div className="deliverable-version"><div><strong>Version {latest.version_number}</strong><p className="muted">{isExternalDeliverable(latest) ? "Linked deliverable" : `${latest.file_name} · ${Math.ceil(Number(latest.file_size) / 1024)} KB`}</p>{latest.submission_note ? <p>{latest.submission_note}</p> : null}</div><div className="inline-actions">{isExternalDeliverable(latest) ? <DeliverableExternalLink href={latest.external_url} fileName={latest.file_name} storageType={latest.storage_type} /> : <>{isPreviewableMimeType(latest.mime_type) ? <Button variant="secondary" size="sm" icon={<Eye size={16} />} onClick={() => setPreviewFile({ id: latest.file_id, fileName: latest.file_name, mimeType: latest.mime_type })}>Preview</Button> : null}<Button variant="ghost" size="sm" icon={<Download size={16} />} onClick={() => void apiDownload(`/files/${latest.file_id}/content`, latest.file_name, accessToken ?? undefined)}>Download</Button></>}{canReview ? <Button variant="primary" size="sm" icon={<MessageSquareText size={16} />} onClick={() => { setReviewing({ deliverable, version: latest }); setDecision("approved"); setComment(""); setReviewIdempotencyKey(newIdempotencyKey()); }}>Review</Button> : null}</div></div> : null}
              {latest && (latest.reviews.length > 0 || latest.messages.length > 0) ? <section className="client-feedback-panel"><h4><MessageSquareText size={14} /> Review conversation</h4>{latest.reviews.map((review) => <div className="conversation-entry client-entry" key={review.id}><div><strong>{review.reviewer_name}</strong><span>{review.decision === "approved" ? "Approved this version" : "Requested changes"}</span></div>{review.comment ? <p>{review.comment}</p> : null}</div>)}{latest.messages.map((message) => <div className={`conversation-entry ${message.author_type}-entry`} key={message.id}><div><strong>{message.author_name}</strong><span>{message.author_type === "staff" ? "Project supervisor" : "Client"}</span></div><p>{message.body}</p></div>)}</section> : null}
              {latest && canParticipate ? <div className="deliverable-card-actions"><Button variant="ghost" size="sm" icon={<MessageSquareText size={15} />} onClick={() => { setMessageVersion(latest); setMessageBody(""); setMessageIdempotencyKey(newIdempotencyKey()); }}>Message supervisor</Button></div> : null}
              {deliverable.versions.length > 1 ? <details className="version-history"><summary>{deliverable.versions.length - 1} earlier version{deliverable.versions.length > 2 ? "s" : ""}</summary>{deliverable.versions.slice(1).map((version) => <div key={version.id}><span>Version {version.version_number}: {version.file_name}</span><div className="inline-actions">{isExternalDeliverable(version) ? <DeliverableExternalLink href={version.external_url} fileName={version.file_name} storageType={version.storage_type} compact /> : <>{isPreviewableMimeType(version.mime_type) ? <Button variant="ghost" size="sm" icon={<Eye size={14} />} onClick={() => setPreviewFile({ id: version.file_id, fileName: version.file_name, mimeType: version.mime_type })}>Preview</Button> : null}<Button variant="ghost" size="sm" icon={<Download size={14} />} onClick={() => void apiDownload(`/files/${version.file_id}/content`, version.file_name, accessToken ?? undefined)}>Download</Button></>}</div></div>)}</details> : null}
            </article>
          );
        })}</div>
        <aside><div className="section-head"><h3>Project updates</h3></div><div className="card activity-list">{project.activity.length ? project.activity.map((item) => <div className="activity-item" key={item.id}><span className="activity-dot" /><div><strong>{item.action.replaceAll("_", " ")}</strong><p className="muted">{item.user_name ?? "Adfix"} · {new Date(item.created_at).toLocaleDateString()}</p></div></div>) : <p className="muted">No shared updates yet.</p>}</div></aside>
      </div>

      <Dialog open={Boolean(reviewing)} onOpenChange={(open) => { if (!open) { setReviewing(null); setReviewIdempotencyKey(newIdempotencyKey()); } }} title={`Review ${reviewing?.deliverable.title ?? "deliverable"}`} description="Your decision goes directly to the project supervisor." footer={<div className="inline-actions"><Button variant="ghost" onClick={() => { setReviewing(null); setReviewIdempotencyKey(newIdempotencyKey()); }}>Cancel</Button><Button variant="primary" type="submit" form="client-review-form" disabled={reviewMutation.isPending || (decision === "changes_requested" && !comment.trim())}>Submit review</Button></div>}>
        <form id="client-review-form" className="modal-form" onSubmit={(event) => { event.preventDefault(); reviewMutation.mutate(); }}>
          <div className="review-choice"><button type="button" className={decision === "approved" ? "review-option selected" : "review-option"} onClick={() => { setDecision("approved"); setReviewIdempotencyKey(newIdempotencyKey()); }}><CheckCircle2 /> Approve</button><button type="button" className={decision === "changes_requested" ? "review-option selected changes" : "review-option changes"} onClick={() => { setDecision("changes_requested"); setReviewIdempotencyKey(newIdempotencyKey()); }}><XCircle /> Request changes</button></div>
          <label className="field"><span>Comment {decision === "changes_requested" ? "(required)" : "(optional)"}</span><textarea value={comment} onChange={(event) => { setComment(event.target.value); setReviewIdempotencyKey(newIdempotencyKey()); }} placeholder="Describe what should change or add an approval note" rows={5} /></label>
        </form>
      </Dialog>

      <Dialog open={Boolean(messageVersion)} onOpenChange={(open) => { if (!open) { setMessageVersion(null); setMessageIdempotencyKey(newIdempotencyKey()); } }} title="Message the project supervisor" description="Ask a question or add context to this deliverable review." footer={<div className="inline-actions"><Button variant="ghost" onClick={() => { setMessageVersion(null); setMessageIdempotencyKey(newIdempotencyKey()); }}>Cancel</Button><Button variant="primary" type="submit" form="client-message-form" icon={<Send size={15} />} disabled={!messageBody.trim() || messageMutation.isPending}>Send message</Button></div>}>
        <form id="client-message-form" className="modal-form" onSubmit={(event) => { event.preventDefault(); messageMutation.mutate(); }}><label className="field"><span>Message</span><textarea autoFocus value={messageBody} onChange={(event) => { setMessageBody(event.target.value); setMessageIdempotencyKey(newIdempotencyKey()); }} rows={5} required /></label></form>
      </Dialog>
      <FilePreviewDialog file={previewFile} onClose={() => setPreviewFile(null)} />
    </section>
  );
}
