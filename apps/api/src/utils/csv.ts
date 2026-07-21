export function escapeCsvField(value: unknown): string {
  if (value === null || typeof value === "undefined") return "";
  const rawValue = String(value);
  const stringValue = /^[=+\-@\t\r]/.test(rawValue) ? `'${rawValue}` : rawValue;
  if (stringValue.includes(",") || stringValue.includes("\"") || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }
  return stringValue;
}

export function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const headerLine = headers.map(escapeCsvField).join(",");
  const lines = rows.map((row) => headers.map((header) => escapeCsvField(row[header])).join(","));
  return [headerLine, ...lines].join("\n");
}
