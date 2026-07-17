import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, FileCheck2, Plus, Send, UploadCloud } from "lucide-react";
import { useState } from "react";
import { apiDownload, apiRequest, apiUpload, ApiError } from "../lib/api";
import { useAuth } from "../state/auth";
import { EmptyState, ErrorState, LoadingState } from "./States";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";

type Review = { id: string; decision: string; comment: string | null; reviewer_name: string; created_at: string };
type Version = { id: string; file_id: string; file_name: string; file_size: string; version_number: number; submission_note: string | null; submitted_at: string; reviews: Review[] };
type Deliverable = { id: string; title: string; description: string | null; status: string; versions: Version[] };

export function ProjectDeliverablesPanel({ projectId, canWrite, deliveryLocked }: { projectId: string; canWrite: boolean; deliveryLocked: boolean }) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [submissionNote, setSubmissionNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["project-deliverables", projectId],
    queryFn: () => apiRequest<{ data: Deliverable[] }>(`/deliverables/project/${projectId}`, { accessToken: accessToken ?? undefined }),
    enabled: Boolean(projectId && accessToken)
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["project-deliverables", projectId] });
  const createMutation = useMutation({
    mutationFn: () => apiRequest("/deliverables", { method: "POST", accessToken: accessToken ?? undefined, body: { projectId, title: title.trim(), description: description.trim() || null } }),
    onSuccess: async () => {
      setTitle("");
      setDescription("");
      setError(null);
      setCreateOpen(false);
      await refresh();
    },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Could not create deliverable.")
  });

  const submitVersionMutation = useMutation({
    mutationFn: async ({ deliverableId, file }: { deliverableId: string; file: File }) => {
      const formData = new FormData();
      formData.set("projectId", projectId);
      formData.set("fileType", "deliverable");
      formData.set("file", file);
      const uploaded = await apiUpload<{ data: { id: string } }>("/files/upload-binary", formData, accessToken ?? undefined);
      return apiRequest(`/deliverables/${deliverableId}/versions`, { method: "POST", accessToken: accessToken ?? undefined, body: { fileId: uploaded.data.id, submissionNote: submissionNote.trim() || null } });
    },
    onSuccess: async () => {
      setUploadingFor(null);
      setSubmissionNote("");
      setError(null);
      await refresh();
    },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Could not submit deliverable version.")
  });

  if (query.isLoading) return <LoadingState message="Loading deliverables..." />;
  if (query.isError) return <ErrorState message="Could not load deliverables." onRetry={() => void query.refetch()} />;

  const selectedDeliverable = query.data?.data.find((deliverable) => deliverable.id === uploadingFor);

  return (
    <div className="deliverables-pane">
      <div className="section-action-bar">
        <div>
          <p className="eyebrow">Client review</p>
          <h2>Deliverables</h2>
          <p className="muted">Manage client-facing work and its review history.</p>
        </div>
        {canWrite && !deliveryLocked ? <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>New deliverable</Button> : null}
      </div>

      {deliveryLocked ? <div className="delivery-notice"><CheckCircle2 size={20} /><div><strong>Delivery is complete</strong><p>Client review actions are frozen. Files and the review history remain available.</p></div></div> : null}
      {error ? <p className="error-text board-error">{error}</p> : null}

      {!query.data?.data.length ? <EmptyState message="Create the first deliverable when work is ready for client review." /> : (
        <div className="deliverable-grid">
          {query.data.data.map((deliverable) => {
            const latest = deliverable.versions[0];
            return <article className="card deliverable-card" key={deliverable.id}>
              <div className="deliverable-heading"><div className="deliverable-icon"><FileCheck2 size={20} /></div><div><h3>{deliverable.title}</h3>{deliverable.description ? <p className="muted">{deliverable.description}</p> : null}</div><span className={`review-status status-${deliverable.status}`}>{deliverable.status.replaceAll("_", " ")}</span></div>
              {latest ? <div className="deliverable-version"><div><strong>Version {latest.version_number}</strong><p className="muted">{latest.file_name} · {Math.ceil(Number(latest.file_size) / 1024)} KB</p>{latest.submission_note ? <p>{latest.submission_note}</p> : null}</div><button className="ghost-button button-with-icon" onClick={() => void apiDownload(`/files/${latest.file_id}/content`, latest.file_name, accessToken ?? undefined)}><Download size={16} /> Download</button></div> : <p className="muted">Draft — upload the first version to request client review.</p>}
              {latest?.reviews.length ? <div className="review-history">{latest.reviews.map((review) => <div className="review-history-item" key={review.id}><CheckCircle2 size={16} /><div><strong>{review.decision.replaceAll("_", " ")}</strong> by {review.reviewer_name}<p>{review.comment}</p></div></div>)}</div> : null}
              {canWrite && !deliveryLocked ? <div className="deliverable-card-actions"><Button variant="ghost" size="sm" icon={<UploadCloud size={16} />} onClick={() => setUploadingFor(deliverable.id)}>{latest ? "Upload new version" : "Upload first version"}</Button></div> : null}
            </article>;
          })}
        </div>
      )}

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create a deliverable"
        description="Add a client-facing item now, then upload a version when it is ready for review."
        footer={<div className="inline-actions"><Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button><Button variant="primary" type="submit" form="create-deliverable-form" icon={<Plus size={16} />} disabled={!title.trim() || createMutation.isPending}>{createMutation.isPending ? "Creating…" : "Create deliverable"}</Button></div>}
      >
        <form id="create-deliverable-form" className="modal-form" onSubmit={(event) => { event.preventDefault(); if (title.trim()) createMutation.mutate(); }}>
          <label className="field"><span>Deliverable title</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Campaign launch film" required /></label>
          <label className="field"><span>Client-facing description <small>Optional</small></span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Briefly explain what the client will review" rows={4} /></label>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(uploadingFor)}
        onOpenChange={(open) => { if (!open) { setUploadingFor(null); setSubmissionNote(""); } }}
        title={selectedDeliverable?.versions.length ? "Upload a new version" : "Upload the first version"}
        description={selectedDeliverable ? `Add a review-ready file to ${selectedDeliverable.title}.` : undefined}
        footer={<div className="inline-actions"><Button variant="ghost" onClick={() => { setUploadingFor(null); setSubmissionNote(""); }}>Cancel</Button><Button variant="primary" type="submit" form="upload-deliverable-version-form" icon={<Send size={16} />} disabled={submitVersionMutation.isPending}>{submitVersionMutation.isPending ? "Submitting…" : "Submit for review"}</Button></div>}
      >
        <form id="upload-deliverable-version-form" className="modal-form" onSubmit={(event) => { event.preventDefault(); const input = event.currentTarget.elements.namedItem("versionFile") as HTMLInputElement; const file = input.files?.[0]; if (file && uploadingFor) submitVersionMutation.mutate({ deliverableId: uploadingFor, file }); }}>
          <label className="field"><span>Version file</span><input name="versionFile" type="file" required /></label>
          <label className="field"><span>Submission note <small>Optional</small></span><textarea value={submissionNote} onChange={(event) => setSubmissionNote(event.target.value)} placeholder="Summarize what changed in this version" rows={4} /></label>
        </form>
      </Dialog>
    </div>
  );
}
