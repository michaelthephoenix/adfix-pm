import {
  CheckCircle2,
  Download,
  Eye,
  History,
  MessageSquareText,
  RotateCcw,
  Send,
  ShieldCheck,
  UploadCloud,
  XCircle
} from "lucide-react";
import { apiDownload } from "../lib/api";
import { Button } from "./ui/Button";
import { DeliverableExternalLink, isExternalDeliverable, type ExternalStorageType } from "./DeliverableExternalLink";
import { isPreviewableMimeType, type PreviewFile } from "./FilePreviewDialog";

type Review = {
  id: string;
  decision: "approved" | "changes_requested";
  comment: string | null;
  reviewer_name: string;
  created_at: string;
};

type Message = {
  id: string;
  author_name: string;
  author_type: "staff" | "client";
  body: string;
  created_at: string;
};

export type DeliverableHistoryVersion = {
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
};

type HistoryEvent = {
  id: string;
  at: string;
  icon: "upload" | "internal-approved" | "internal-changes" | "client-submit" | "client-approved" | "client-changes" | "message" | "withdraw";
  title: string;
  actor: string;
  body?: string | null;
};

function eventIcon(icon: HistoryEvent["icon"]) {
  if (icon === "upload") return <UploadCloud size={15} />;
  if (icon === "internal-approved") return <ShieldCheck size={15} />;
  if (icon === "internal-changes" || icon === "client-changes") return <XCircle size={15} />;
  if (icon === "client-submit") return <Send size={15} />;
  if (icon === "client-approved") return <CheckCircle2 size={15} />;
  if (icon === "withdraw") return <RotateCcw size={15} />;
  return <MessageSquareText size={15} />;
}

function versionEvents(version: DeliverableHistoryVersion): HistoryEvent[] {
  const events: HistoryEvent[] = [{
    id: `${version.id}:submitted`,
    at: version.submitted_at,
    icon: "upload",
    title: "Submitted for internal review",
    actor: version.submitted_by_name,
    body: version.submission_note
  }];
  for (const review of version.internal_reviews) {
    events.push({
      id: `internal:${review.id}`,
      at: review.created_at,
      icon: review.decision === "approved" ? "internal-approved" : "internal-changes",
      title: review.decision === "approved" ? "Approved internally" : "Returned to the team",
      actor: review.reviewer_name,
      body: review.comment
    });
  }
  if (version.client_submitted_at) {
    events.push({
      id: `${version.id}:client-submitted`,
      at: version.client_submitted_at,
      icon: "client-submit",
      title: "Submitted to the client",
      actor: version.client_submitted_by_name ?? "Project supervisor"
    });
  }
  for (const review of version.reviews) {
    events.push({
      id: `client:${review.id}`,
      at: review.created_at,
      icon: review.decision === "approved" ? "client-approved" : "client-changes",
      title: review.decision === "approved" ? "Approved by the client" : "Client requested changes",
      actor: review.reviewer_name,
      body: review.comment
    });
  }
  for (const message of version.messages) {
    events.push({
      id: `message:${message.id}`,
      at: message.created_at,
      icon: "message",
      title: message.author_type === "client" ? "Client message" : "Team reply",
      actor: message.author_name,
      body: message.body
    });
  }
  if (version.client_withdrawn_at) {
    events.push({
      id: `${version.id}:withdrawn`,
      at: version.client_withdrawn_at,
      icon: "withdraw",
      title: "Pulled back from client review",
      actor: version.client_withdrawn_by_name ?? "Project supervisor"
    });
  }
  return events.sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime());
}

export function DeliverableVersionHistory({
  versions,
  accessToken,
  onPreview
}: {
  versions: DeliverableHistoryVersion[];
  accessToken?: string;
  onPreview: (file: PreviewFile) => void;
}) {
  if (versions.length === 0) return <p className="muted">No version uploaded yet.</p>;

  return (
    <section className="deliverable-version-history" aria-label="Complete deliverable version history">
      <div className="version-history-heading"><History size={16} /><strong>Version history</strong><span>{versions.length}</span></div>
      {versions.map((version, index) => (
        <details className="version-history-item" key={version.id} open={index === 0}>
          <summary>
            <span><strong>Version {version.version_number}</strong><small>{version.file_name}</small></span>
            <time dateTime={version.submitted_at}>{new Date(version.submitted_at).toLocaleString()}</time>
          </summary>
          <div className="version-history-content">
            <div className="version-history-file">
              <div><strong>{version.file_name}</strong><span>{Math.ceil(Number(version.file_size) / 1024)} KB</span></div>
              <div className="inline-actions">
                {isExternalDeliverable(version) ? (
                  <DeliverableExternalLink href={version.external_url} fileName={version.file_name} storageType={version.storage_type} />
                ) : (
                  <>
                    {isPreviewableMimeType(version.mime_type) ? (
                      <Button variant="secondary" size="sm" icon={<Eye size={14} />} onClick={() => onPreview({ id: version.file_id, fileName: version.file_name, mimeType: version.mime_type })}>Preview</Button>
                    ) : null}
                    <Button variant="ghost" size="sm" icon={<Download size={14} />} onClick={() => void apiDownload(`/files/${version.file_id}/content`, version.file_name, accessToken)}>Download</Button>
                  </>
                )}
              </div>
            </div>
            <ol className="version-event-list">
              {versionEvents(version).map((event) => (
                <li key={event.id}>
                  <span className={`version-event-icon event-${event.icon}`}>{eventIcon(event.icon)}</span>
                  <div><strong>{event.title}</strong><span>{event.actor} · <time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time></span>{event.body ? <p>{event.body}</p> : null}</div>
                </li>
              ))}
            </ol>
          </div>
        </details>
      ))}
    </section>
  );
}
