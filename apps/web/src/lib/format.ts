const fileSizeFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

export function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${fileSizeFormatter.format(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${fileSizeFormatter.format(bytes / 1024 ** 2)} MB`;
  return `${fileSizeFormatter.format(bytes / 1024 ** 3)} GB`;
}

function toDate(value: string | Date) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  return value instanceof Date ? value : new Date(value);
}

export function formatLocalDate(value: string | Date) {
  const date = toDate(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

export function formatLocalDateTime(value: string | Date) {
  const date = toDate(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
