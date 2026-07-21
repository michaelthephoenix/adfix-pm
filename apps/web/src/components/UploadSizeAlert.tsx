import { TriangleAlert } from "lucide-react";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function formatFileSize(size: number) {
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadSizeAlert({
  fileName,
  fileSize,
  suggestLink = false,
  id
}: {
  fileName: string;
  fileSize: number;
  suggestLink?: boolean;
  id?: string;
}) {
  return (
    <div className="upload-size-alert" role="alert" id={id}>
      <span className="upload-size-alert-icon" aria-hidden="true"><TriangleAlert size={18} /></span>
      <div>
        <strong>File is too large</strong>
        <p>
          {fileName} is {formatFileSize(fileSize)}. The maximum upload size is 50 MB.{" "}
          {suggestLink ? "Choose a smaller file or share it as a link." : "Choose a smaller file before uploading."}
        </p>
      </div>
    </div>
  );
}
