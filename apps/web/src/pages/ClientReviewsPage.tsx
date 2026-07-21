import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckCircle2,
  Download,
  Eye,
  FileCheck2,
  MessageSquareText,
  XCircle
} from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DeliverableExternalLink, type ExternalStorageType } from "../components/DeliverableExternalLink";
import { FilePreviewDialog, isPreviewableMimeType, type PreviewFile } from "../components/FilePreviewDialog";
import { EmptyState, ErrorState, LoadingState } from "../components/States";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { PageHeader } from "../components/ui/PageHeader";
import { ApiError, apiDownload, apiRequest } from "../lib/api";
import { formatLocalDate, formatLocalDateTime } from "../lib/format";
import { useAuth } from "../state/auth";
import { useUI } from "../state/ui";

type ReviewFilter = "pending" | "reviewed" | "history";
type ReviewSort = "oldest" | "newest" | "deadline";
type Decision = "approved" | "changes_requested";

type ReviewInboxItem = {
  versionId: string;
  deliverableId: string;
  deliverableTitle: string;
  deliverableDescription: string | null;
  deliverableStatus: string;
  versionNumber: number;
  submissionNote: string | null;
  clientSubmittedAt: string;
  file: {
    id: string;
    name: string;
    size: string;
    mimeType: string;
    storageType: "local" | "s3" | ExternalStorageType;
    externalUrl: string | null;
  };
  project: { id: string; name: string; phase: string; deadline: string };
  client: { id: string; name: string };
  clientRole: "reviewer" | "viewer";
  review: {
    id: string;
    decision: Decision;
    comment: string | null;
    reviewedAt: string;
    reviewerName: string;
  } | null;
  canReview: boolean;
};

type ReviewInboxResponse = {
  data: ReviewInboxItem[];
  meta: {
    status: ReviewFilter;
    sort: ReviewSort;
    counts: Record<ReviewFilter, number>;
  };
};

const filters: Array<{ value: ReviewFilter; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "reviewed", label: "Reviewed" },
  { value: "history", label: "History" }
];

function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isReviewFilter(value: string | null): value is ReviewFilter {
  return value === "pending" || value === "reviewed" || value === "history";
}

function isReviewSort(value: string | null): value is ReviewSort {
  return value === "oldest" || value === "newest" || value === "deadline";
}

function readableSize(value: string) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return "File";
  if (bytes < 1_048_576) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function ClientReviewsPage() {
  const { accessToken } = useAuth();
  const ui = useUI();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const status = isReviewFilter(searchParams.get("status")) ? searchParams.get("status") as ReviewFilter : "pending";
  const defaultSort: ReviewSort = status === "pending" ? "oldest" : "newest";
  const sort = isReviewSort(searchParams.get("sort")) ? searchParams.get("sort") as ReviewSort : defaultSort;
  const [reviewing, setReviewing] = useState<ReviewInboxItem | null>(null);
  const [decision, setDecision] = useState<Decision>("approved");
  const [comment, setComment] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);

  const reviewsQuery = useQuery({
    queryKey: ["client-review-inbox", status, sort],
    queryFn: () => apiRequest<ReviewInboxResponse>(`/client-portal/reviews?status=${status}&sort=${sort}`, {
      accessToken: accessToken ?? undefined
    }),
    enabled: Boolean(accessToken)
  });

  const reviewMutation = useMutation({
    mutationFn: () => apiRequest(`/client-portal/versions/${reviewing?.versionId}/reviews`, {
      method: "POST",
      accessToken: accessToken ?? undefined,
      idempotencyKey,
      body: { decision, comment: comment.trim() || null }
    }),
    onSuccess: async () => {
      setReviewing(null);
      setComment("");
      setIdempotencyKey(newIdempotencyKey());
      ui.success(decision === "approved" ? "Deliverable approved." : "Your change request was sent to the project supervisor.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["client-review-inbox"] }),
        queryClient.invalidateQueries({ queryKey: ["client-portal-projects"] }),
        queryClient.invalidateQueries({ queryKey: ["client-portal-project"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications"] })
      ]);
    },
    onError: (error) => ui.error(error instanceof ApiError ? error.message : "Could not submit your review.")
  });

  const setFilter = (nextStatus: ReviewFilter) => {
    const next = new URLSearchParams(searchParams);
    next.set("status", nextStatus);
    next.set("sort", nextStatus === "pending" ? "oldest" : "newest");
    setSearchParams(next);
  };

  const setSort = (nextSort: ReviewSort) => {
    const next = new URLSearchParams(searchParams);
    next.set("status", status);
    next.set("sort", nextSort);
    setSearchParams(next);
  };

  if (reviewsQuery.isLoading) return <LoadingState message="Loading your review inbox..." />;
  if (reviewsQuery.isError) return <ErrorState message="Could not load your review inbox." onRetry={() => void reviewsQuery.refetch()} />;

  const items = reviewsQuery.data?.data ?? [];
  const counts = reviewsQuery.data?.meta.counts ?? { pending: 0, reviewed: 0, history: 0 };

  return (
    <section className="client-review-inbox">
      <PageHeader
        title="Reviews"
        description="Review work shared by your project supervisors without searching through every project."
        meta={counts.pending > 0 ? <Badge tone="warning">{counts.pending} awaiting review</Badge> : <span>Up to date</span>}
      />

      <div className="review-inbox-toolbar">
        <div className="segmented-control" role="tablist" aria-label="Review inbox filter">
          {filters.map((filter) => (
            <button
              key={filter.value}
              type="button"
              role="tab"
              aria-selected={status === filter.value}
              onClick={() => setFilter(filter.value)}
            >
              {filter.label} <span>{counts[filter.value]}</span>
            </button>
          ))}
        </div>
        <label className="review-sort-field">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as ReviewSort)}>
            <option value="oldest">Oldest request first</option>
            <option value="newest">Newest first</option>
            <option value="deadline">Project deadline</option>
          </select>
        </label>
      </div>

      {items.length === 0 ? (
        <EmptyState message={status === "pending" ? "You have no deliverables waiting for review." : status === "reviewed" ? "No reviewed deliverables yet." : "No client-visible review history yet."} />
      ) : (
        <div className="review-inbox-list">
          {items.map((item) => {
            const external = Boolean(item.file.externalUrl) && ["google_drive", "dropbox", "onedrive", "external"].includes(item.file.storageType);
            return (
              <article className="card review-inbox-card" key={item.versionId}>
                <div className="review-inbox-main">
                  <span className={`review-inbox-status ${item.review?.decision ?? "pending"}`}>
                    {item.review?.decision === "approved" ? <CheckCircle2 size={17} /> : item.review?.decision === "changes_requested" ? <XCircle size={17} /> : <FileCheck2 size={17} />}
                  </span>
                  <div className="review-inbox-copy">
                    <div className="review-inbox-titleline">
                      <div><p className="eyebrow">{item.client.name} · {item.project.name}</p><h3>{item.deliverableTitle}</h3></div>
                      <span className={`review-status status-${item.review?.decision ?? "in_review"}`}>
                        {item.review?.decision === "approved" ? "Approved" : item.review?.decision === "changes_requested" ? "Changes requested" : item.clientRole === "viewer" ? "Read only" : "Your review needed"}
                      </span>
                    </div>
                    {item.deliverableDescription ? <p>{item.deliverableDescription}</p> : null}
                    <div className="review-inbox-meta">
                      <span>Version {item.versionNumber}</span>
                      <span><CalendarDays size={13} /> Project due {formatLocalDate(item.project.deadline)}</span>
                      <span>Shared {formatLocalDate(item.clientSubmittedAt)}</span>
                    </div>
                    {item.submissionNote ? <p className="review-submission-note">{item.submissionNote}</p> : null}
                    {item.review ? (
                      <div className={`review-decision-summary ${item.review.decision}`}>
                        <strong>{item.review.reviewerName} {item.review.decision === "approved" ? "approved this version" : "requested changes"}</strong>
                        {item.review.comment ? <p>{item.review.comment}</p> : null}
                        <time dateTime={item.review.reviewedAt}>{formatLocalDateTime(item.review.reviewedAt)}</time>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="review-inbox-actions">
                  {external ? (
                    <DeliverableExternalLink
                      href={item.file.externalUrl!}
                      fileName={item.file.name}
                      storageType={item.file.storageType as ExternalStorageType}
                      compact
                    />
                  ) : (
                    <>
                      {isPreviewableMimeType(item.file.mimeType) ? (
                        <Button variant="secondary" size="sm" icon={<Eye size={15} />} onClick={() => setPreviewFile({ id: item.file.id, fileName: item.file.name, mimeType: item.file.mimeType })}>Preview</Button>
                      ) : null}
                      <Button variant="ghost" size="sm" icon={<Download size={15} />} onClick={() => void apiDownload(`/files/${item.file.id}/content`, item.file.name, accessToken ?? undefined)}>Download · {readableSize(item.file.size)}</Button>
                    </>
                  )}
                  {item.canReview ? (
                    <Button variant="primary" size="sm" icon={<MessageSquareText size={15} />} onClick={() => { setReviewing(item); setDecision("approved"); setComment(""); setIdempotencyKey(newIdempotencyKey()); }}>Review now</Button>
                  ) : <Link className="text-link" to={`/portal/projects/${item.project.id}`}>{status === "history" ? "Open project" : "View details"}</Link>}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Dialog
        open={Boolean(reviewing)}
        onOpenChange={(open) => { if (!open) setReviewing(null); }}
        title={`Review ${reviewing?.deliverableTitle ?? "deliverable"}`}
        description="Your decision goes directly to the project supervisor."
        footer={<div className="inline-actions"><Button variant="ghost" onClick={() => setReviewing(null)}>Cancel</Button><Button variant="primary" type="submit" form="review-inbox-decision-form" disabled={reviewMutation.isPending || (decision === "changes_requested" && !comment.trim())}>{reviewMutation.isPending ? "Submitting..." : "Submit review"}</Button></div>}
      >
        <form id="review-inbox-decision-form" className="modal-form" onSubmit={(event) => { event.preventDefault(); reviewMutation.mutate(); }}>
          <div className="review-choice">
            <button type="button" className={decision === "approved" ? "review-option selected" : "review-option"} onClick={() => { setDecision("approved"); setIdempotencyKey(newIdempotencyKey()); }}><CheckCircle2 /> Approve</button>
            <button type="button" className={decision === "changes_requested" ? "review-option selected changes" : "review-option changes"} onClick={() => { setDecision("changes_requested"); setIdempotencyKey(newIdempotencyKey()); }}><XCircle /> Request changes</button>
          </div>
          <label className="field"><span>Comment {decision === "changes_requested" ? "(required)" : "(optional)"}</span><textarea rows={5} value={comment} onChange={(event) => { setComment(event.target.value); setIdempotencyKey(newIdempotencyKey()); }} placeholder="Share clear feedback with the project supervisor" /></label>
        </form>
      </Dialog>
      <FilePreviewDialog file={previewFile} onClose={() => setPreviewFile(null)} />
    </section>
  );
}
