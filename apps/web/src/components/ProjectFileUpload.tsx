import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp, UploadCloud } from "lucide-react";
import { useState } from "react";
import { apiUpload, ApiError } from "../lib/api";
import { useAuth } from "../state/auth";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";

type UploadResponse = { data: { id: string; file_name: string } };

type ProjectFileUploadProps = {
  projectId: string;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ProjectFileUpload({ projectId, disabled = false, open, onOpenChange }: ProjectFileUploadProps) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState("asset");
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setFile(null);
    setError(null);
    const input = document.getElementById(`file-upload-${projectId}`) as HTMLInputElement | null;
    if (input) input.value = "";
  };

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new ApiError("Choose a file to upload.", 400);
      if (file.size > 50 * 1024 * 1024) throw new ApiError("Files must be 50 MB or smaller.", 400);
      const formData = new FormData();
      formData.set("projectId", projectId);
      formData.set("fileType", fileType);
      formData.set("file", file);
      return apiUpload<UploadResponse>("/files/upload-binary", formData, accessToken ?? undefined);
    },
    onSuccess: async () => {
      resetForm();
      onOpenChange(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["project-files", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["project-activity", projectId] })
      ]);
    },
    onError: (caught) => setError(caught instanceof ApiError ? caught.message : "Upload failed.")
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => { if (!nextOpen && !uploadMutation.isPending) resetForm(); onOpenChange(nextOpen); }}
      title="Upload a project file"
      description="Add a file to the shared project library. Files can be up to 50 MB."
      footer={<div className="inline-actions"><Button variant="ghost" onClick={() => onOpenChange(false)} disabled={uploadMutation.isPending}>Cancel</Button><Button variant="primary" type="submit" form="project-file-upload-form" icon={<UploadCloud size={16} />} disabled={disabled || !file || uploadMutation.isPending}>{uploadMutation.isPending ? "Uploading…" : "Upload file"}</Button></div>}
    >
      <form id="project-file-upload-form" className="modal-form" onSubmit={(event) => { event.preventDefault(); uploadMutation.mutate(); }}>
        <label className="upload-dropzone" htmlFor={`file-upload-${projectId}`}>
          <FileUp size={24} />
          <strong>{file ? file.name : "Choose a file"}</strong>
          <small>{file ? `${Math.ceil(file.size / 1024)} KB selected` : "PDF, images, video, Office files, ZIP, or text"}</small>
          <input id={`file-upload-${projectId}`} type="file" disabled={disabled || uploadMutation.isPending} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <label className="field"><span>File category</span><select value={fileType} onChange={(event) => setFileType(event.target.value)} disabled={disabled}>
          <option value="asset">Asset</option>
          <option value="proposal">Proposal</option>
          <option value="creative_brief">Creative brief</option>
          <option value="contract">Contract</option>
          <option value="deliverable">Deliverable</option>
          <option value="other">Other</option>
        </select></label>
        {error ? <p className="error-text">{error}</p> : null}
      </form>
    </Dialog>
  );
}
