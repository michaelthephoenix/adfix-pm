import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp, UploadCloud, XCircle } from "lucide-react";
import { useRef, useState } from "react";
import { apiUpload, ApiError } from "../lib/api";
import { formatFileSize } from "../lib/format";
import { useAuth } from "../state/auth";
import { useUI } from "../state/ui";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { MAX_UPLOAD_BYTES, UploadSizeAlert } from "./UploadSizeAlert";

type UploadResponse = { data: { id: string; file_name: string } };

type ProjectFileUploadProps = {
  projectId: string;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ProjectFileUpload({ projectId, disabled = false, open, onOpenChange }: ProjectFileUploadProps) {
  const { accessToken } = useAuth();
  const ui = useUI();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [oversizedFile, setOversizedFile] = useState<{ name: string; size: number } | null>(null);
  const [fileType, setFileType] = useState("asset");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const uploadAbortRef = useRef<AbortController | null>(null);

  const resetForm = () => {
    setFile(null);
    setOversizedFile(null);
    setError(null);
    setProgress(0);
    const input = document.getElementById(`file-upload-${projectId}`) as HTMLInputElement | null;
    if (input) input.value = "";
  };

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new ApiError("Choose a file to upload.", 400);
      if (file.size > MAX_UPLOAD_BYTES) throw new ApiError("Files must be 50 MB or smaller.", 400);
      const formData = new FormData();
      formData.set("projectId", projectId);
      formData.set("fileType", fileType);
      formData.set("file", file);
      const abortController = new AbortController();
      uploadAbortRef.current = abortController;
      const timeoutMs = Math.min(5 * 60_000, 30_000 + Math.ceil(file.size / (1024 * 1024)) * 4_000);
      return apiUpload<UploadResponse>("/files/upload-binary", formData, accessToken ?? undefined, {
        signal: abortController.signal,
        timeoutMs,
        onProgress: setProgress
      });
    },
    onSuccess: async () => {
      resetForm();
      onOpenChange(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project-files", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["project-activity", projectId] })
      ]);
    },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Upload failed."),
    onSettled: () => { uploadAbortRef.current = null; }
  });

  const requestClose = async () => {
    if (uploadMutation.isPending) return;
    if (file || oversizedFile) {
      const discard = await ui.confirm({
        title: "Discard this upload?",
        message: "The selected file and category will be cleared.",
        confirmLabel: "Discard upload",
        cancelLabel: "Keep editing",
        tone: "warning"
      });
      if (!discard) return;
    }
    resetForm();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => { if (!nextOpen) void requestClose(); }}
      title="Upload a project file"
      description="Add a file to the shared project library. Files can be up to 50 MB."
      footer={(
        <div className="inline-actions">
          {uploadMutation.isPending ? (
            <Button variant="danger" icon={<XCircle size={16} />} onClick={() => uploadAbortRef.current?.abort()}>Cancel upload</Button>
          ) : (
            <Button variant="ghost" onClick={() => void requestClose()}>Cancel</Button>
          )}
          <Button variant="primary" type="submit" form="project-file-upload-form" icon={<UploadCloud size={16} />} disabled={disabled || !file || uploadMutation.isPending}>
            {uploadMutation.isPending ? `Uploading ${progress}%` : "Upload file"}
          </Button>
        </div>
      )}
    >
      <form id="project-file-upload-form" className="modal-form" onSubmit={(event) => { event.preventDefault(); uploadMutation.mutate(); }}>
        <label className="upload-dropzone" htmlFor={`file-upload-${projectId}`}>
          <FileUp size={24} />
          <strong>{file ? file.name : "Choose a file"}</strong>
          <small>{file ? `${formatFileSize(file.size)} selected` : "PDF, images, video, Office files, ZIP, or text"}</small>
          <input
            id={`file-upload-${projectId}`}
            type="file"
            aria-label="Project file"
            aria-describedby={oversizedFile ? `file-upload-size-error-${projectId}` : undefined}
            disabled={disabled || uploadMutation.isPending}
            onChange={(event) => {
              const nextFile = event.target.files?.[0] ?? null;
              setError(null);
              if (nextFile && nextFile.size > MAX_UPLOAD_BYTES) {
                setFile(null);
                setOversizedFile({ name: nextFile.name, size: nextFile.size });
                event.currentTarget.value = "";
                return;
              }
              setOversizedFile(null);
              setFile(nextFile);
            }}
          />
        </label>
        {uploadMutation.isPending ? (
          <div className="upload-progress" aria-live="polite">
            <span style={{ width: `${progress}%` }} />
            <strong>{progress}% uploaded</strong>
          </div>
        ) : null}
        {oversizedFile ? <UploadSizeAlert id={`file-upload-size-error-${projectId}`} fileName={oversizedFile.name} fileSize={oversizedFile.size} /> : null}
        <label className="field">
          <span>File category</span>
          <select value={fileType} onChange={(event) => setFileType(event.target.value)} disabled={disabled || uploadMutation.isPending}>
            <option value="asset">Asset</option>
            <option value="proposal">Proposal</option>
            <option value="creative_brief">Creative brief</option>
            <option value="contract">Contract</option>
            <option value="deliverable">Deliverable</option>
            <option value="other">Other</option>
          </select>
        </label>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
      </form>
    </Dialog>
  );
}
