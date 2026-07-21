import { useEffect, useState } from "react";
import { Download, ExternalLink, FileWarning } from "lucide-react";
import { apiAssetUrl, apiDownload, apiRequest, ApiError } from "../lib/api";
import { useAuth } from "../state/auth";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";

const previewMimeTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "text/plain"
]);

export type PreviewFile = {
  id: string;
  fileName: string;
  mimeType: string;
};

type PreviewSession = {
  data: {
    path: string;
    fileName: string;
    mimeType: string;
    kind: "image" | "video" | "audio" | "pdf" | "text";
    expiresInSeconds: number;
  };
};

export function isPreviewableMimeType(mimeType: string) {
  return previewMimeTypes.has(mimeType);
}

export function FilePreviewDialog({ file, onClose }: { file: PreviewFile | null; onClose: () => void }) {
  const { accessToken } = useAuth();
  const [session, setSession] = useState<PreviewSession["data"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderFailed, setRenderFailed] = useState(false);

  useEffect(() => {
    if (!file || !accessToken) {
      setSession(null);
      setError(null);
      setRenderFailed(false);
      return;
    }
    let active = true;
    setSession(null);
    setError(null);
    setRenderFailed(false);
    void apiRequest<PreviewSession>(`/files/${file.id}/preview-session`, {
      method: "POST",
      accessToken
    }).then((result) => {
      if (active) setSession(result.data);
    }).catch((caught) => {
      if (!active) return;
      setError(caught instanceof ApiError ? caught.message : "This preview could not be opened.");
    });
    return () => { active = false; };
  }, [accessToken, file]);

  const previewUrl = session ? apiAssetUrl(session.path) : null;
  const fallback = error || renderFailed;
  return (
    <Dialog
      open={Boolean(file)}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title={file?.fileName ?? "File preview"}
      description="Previewed securely inside Adfix. Nothing loads until this window is opened."
      size="xl"
      footer={<div className="inline-actions">
        {file ? <Button variant="secondary" icon={<Download size={15} />} onClick={() => void apiDownload(`/files/${file.id}/content`, file.fileName, accessToken ?? undefined)}>Download</Button> : null}
        <Button variant="primary" onClick={onClose}>Close preview</Button>
      </div>}
    >
      <div className="file-preview-stage">
        {!session && !fallback ? <div className="file-preview-loading"><span className="preview-spinner" /><strong>Preparing secure preview…</strong><p>Only this file will be requested.</p></div> : null}
        {fallback ? <div className="file-preview-fallback"><FileWarning size={32} /><strong>Preview unavailable</strong><p>{error ?? "Your browser could not display this format. Download it to view the original file."}</p><span><ExternalLink size={14} /> The original file is unchanged.</span></div> : null}
        {session && previewUrl && !fallback && session.kind === "image" ? <img className="file-preview-image" src={previewUrl} alt={`Preview of ${session.fileName}`} decoding="async" onError={() => setRenderFailed(true)} /> : null}
        {session && previewUrl && !fallback && session.kind === "video" ? <video className="file-preview-video" src={previewUrl} aria-label={`Preview of ${session.fileName}`} controls preload="metadata" playsInline onError={() => setRenderFailed(true)}>Your browser cannot preview this video.</video> : null}
        {session && previewUrl && !fallback && session.kind === "audio" ? <div className="file-preview-audio"><strong>{session.fileName}</strong><audio src={previewUrl} aria-label={`Preview of ${session.fileName}`} controls preload="metadata" onError={() => setRenderFailed(true)}>Your browser cannot preview this audio.</audio></div> : null}
        {session && previewUrl && !fallback && (session.kind === "pdf" || session.kind === "text") ? <iframe className="file-preview-document" src={previewUrl} title={`Preview of ${session.fileName}`} onError={() => setRenderFailed(true)} /> : null}
      </div>
      <p className="file-preview-footnote">Large media is streamed in sections. Closing this window stops playback and releases the preview.</p>
    </Dialog>
  );
}
