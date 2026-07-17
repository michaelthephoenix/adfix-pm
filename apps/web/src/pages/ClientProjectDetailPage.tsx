import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Download, FileText, MessageSquareText, XCircle } from "lucide-react";
import { apiDownload, apiRequest, ApiError } from "../lib/api";
import { useAuth } from "../state/auth";
import { EmptyState, ErrorState, LoadingState } from "../components/States";

type Review = { id: string; decision: string; comment: string | null; reviewer_name: string; created_at: string };
type Version = { id: string; file_id: string; file_name: string; file_size: string; version_number: number; submission_note: string | null; submitted_at: string; reviews: Review[] };
type Deliverable = { id: string; title: string; description: string | null; status: string; versions: Version[] };
type PortalProject = { id: string; name: string; client_name: string; client_role: "reviewer" | "viewer"; description: string | null; current_phase: string; deadline: string; deliverables: Deliverable[]; activity: Array<{ id: string; action: string; created_at: string; user_name: string | null }> };

export function ClientProjectDetailPage() {
  const { projectId = "" } = useParams();
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = useState<{ deliverable: Deliverable; version: Version } | null>(null);
  const [decision, setDecision] = useState<"approved" | "changes_requested">("approved");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["client-portal-project", projectId],
    queryFn: () => apiRequest<{ data: PortalProject }>(`/client-portal/projects/${projectId}`, { accessToken: accessToken ?? undefined }),
    enabled: Boolean(projectId && accessToken)
  });
  const reviewMutation = useMutation({
    mutationFn: () => apiRequest(`/client-portal/versions/${reviewing?.version.id}/reviews`, { method: "POST", accessToken: accessToken ?? undefined, body: { decision, comment: comment || null } }),
    onSuccess: async () => { setReviewing(null); setComment(""); setError(null); await queryClient.invalidateQueries({ queryKey: ["client-portal-project", projectId] }); },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Could not submit review.")
  });
  if (query.isLoading) return <LoadingState message="Loading project..." />;
  if (query.isError || !query.data) return <ErrorState message="Could not load this project." onRetry={() => void query.refetch()} />;
  const project = query.data.data;
  const reviewsLocked = project.current_phase === "delivery";
  const canReview = project.client_role === "reviewer" && !reviewsLocked;
  return (
    <section>
      <header className="portal-project-header"><div><p className="eyebrow">{project.client_name}</p><h2>{project.name}</h2><p>{project.description}</p></div><div><span className={`phase-pill phase-pill-${project.current_phase}`}>{project.current_phase.replaceAll("_", " ")}</span><p className="muted">Deadline {new Date(project.deadline).toLocaleDateString()}</p></div></header>
      {reviewsLocked ? <div className="delivery-notice"><CheckCircle2 size={20} /><div><strong>Project delivered</strong><p>Reviews are now closed. Final files and review history remain available.</p></div></div> : null}
      {project.client_role === "viewer" ? <div className="portal-access-notice"><FileText size={18} /><div><strong>Read-only access</strong><p>You can view and download shared deliverables. Review decisions and comments are reserved for client reviewers.</p></div></div> : null}
      <div className="portal-detail-grid">
        <div><div className="section-head"><h3>Deliverables</h3></div>{project.deliverables.length === 0 ? <EmptyState message="No deliverables have been submitted yet." /> : project.deliverables.map((deliverable) => {
          const latest = deliverable.versions[0];
          return <article className="card deliverable-card" key={deliverable.id}>
            <div className="deliverable-heading"><div className="deliverable-icon"><FileText size={20} /></div><div><h3>{deliverable.title}</h3><p className="muted">{deliverable.description}</p></div><span className={`review-status status-${deliverable.status}`}>{deliverable.status.replaceAll("_", " ")}</span></div>
            {latest ? <div className="deliverable-version"><div><strong>Version {latest.version_number}</strong><p className="muted">{latest.file_name} · {Math.ceil(Number(latest.file_size) / 1024)} KB</p><p>{latest.submission_note}</p></div><div className="inline-actions"><button className="ghost-button button-with-icon" onClick={() => void apiDownload(`/files/${latest.file_id}/content`, latest.file_name, accessToken ?? undefined)}><Download size={16} /> Download</button>{canReview ? <button className="primary-button button-with-icon" onClick={() => setReviewing({ deliverable, version: latest })}><MessageSquareText size={16} /> Review</button> : null}</div></div> : <p className="muted">Draft — no version submitted.</p>}
            {latest?.reviews.length ? <div className="review-history">{latest.reviews.map((review) => <div key={review.id} className="review-history-item">{review.decision === "approved" ? <CheckCircle2 size={17} /> : <XCircle size={17} />}<div><strong>{review.decision.replaceAll("_", " ")}</strong> by {review.reviewer_name}<p>{review.comment}</p></div></div>)}</div> : null}
          </article>;
        })}</div>
        <aside><div className="section-head"><h3>Project updates</h3></div><div className="card activity-list">{project.activity.map((item) => <div className="activity-item" key={item.id}><span className="activity-dot" /><div><strong>{item.action.replaceAll("_", " ")}</strong><p className="muted">{item.user_name ?? "Adfix"} · {new Date(item.created_at).toLocaleDateString()}</p></div></div>)}</div></aside>
      </div>
      {reviewing ? <div className="modal-backdrop" role="presentation"><section className="confirm-card review-dialog" role="dialog" aria-modal="true" aria-labelledby="review-title"><h3 id="review-title">Review {reviewing.deliverable.title}</h3><div className="review-choice"><button className={decision === "approved" ? "review-option selected" : "review-option"} onClick={() => setDecision("approved")}><CheckCircle2 /> Approve</button><button className={decision === "changes_requested" ? "review-option selected changes" : "review-option changes"} onClick={() => setDecision("changes_requested")}><XCircle /> Request changes</button></div><label className="field">Comment {decision === "changes_requested" ? "(required)" : "(optional)"}<textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={4} /></label>{error ? <p className="error-text">{error}</p> : null}<div className="inline-actions"><button className="ghost-button" onClick={() => setReviewing(null)}>Cancel</button><button className="primary-button" disabled={reviewMutation.isPending || (decision === "changes_requested" && !comment.trim())} onClick={() => reviewMutation.mutate()}>Submit review</button></div></section></div> : null}
    </section>
  );
}
