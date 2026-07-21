import { ExternalLink, Link2 } from "lucide-react";

export type ExternalStorageType = "google_drive" | "dropbox" | "onedrive" | "external";

const providerNames: Record<ExternalStorageType, string> = {
  google_drive: "Google Drive",
  dropbox: "Dropbox",
  onedrive: "OneDrive",
  external: "External link"
};

export function isExternalDeliverable(
  version: { storage_type?: string; external_url?: string | null }
): version is { storage_type: ExternalStorageType; external_url: string } {
  return Boolean(version.external_url) && ["google_drive", "dropbox", "onedrive", "external"].includes(version.storage_type ?? "");
}

function safeWebUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

export function DeliverableExternalLink({
  href,
  fileName,
  storageType,
  compact = false
}: {
  href: string;
  fileName: string;
  storageType: ExternalStorageType;
  compact?: boolean;
}) {
  const url = safeWebUrl(href);
  if (!url) return <span className="deliverable-link-unavailable">Link unavailable</span>;
  const provider = providerNames[storageType];
  const hostname = url.hostname.replace(/^www\./, "");

  return (
    <a
      className={compact ? "deliverable-link-card compact" : "deliverable-link-card"}
      href={url.toString()}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${fileName} on ${provider}`}
    >
      <span className="deliverable-link-icon"><Link2 size={compact ? 15 : 18} /></span>
      <span className="deliverable-link-copy">
        {!compact ? <strong>{fileName}</strong> : null}
        <span>{provider}{hostname ? ` · ${hostname}` : ""}</span>
        {!compact ? <small>Open the submitted work in a new tab</small> : null}
      </span>
      <span className="deliverable-link-action">Open link <ExternalLink size={compact ? 13 : 15} /></span>
    </a>
  );
}
