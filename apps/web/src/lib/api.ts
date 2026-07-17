const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";
const API_TIMEOUT_MS = 12_000;
let unauthorizedHandler: (() => void) | null = null;
let refreshHandler: (() => Promise<string | null>) | null = null;
let refreshPromise: Promise<string | null> | null = null;

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  accessToken?: string;
  skipAuthRetry?: boolean;
};

export class ApiError extends Error {
  status: number;
  code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

export function setRefreshHandler(handler: (() => Promise<string | null>) | null) {
  refreshHandler = handler;
}

async function parseError(response: Response) {
  let payload: { error?: string; code?: string } | null = null;
  try {
    payload = (await response.json()) as { error?: string; code?: string };
  } catch {
    payload = null;
  }
  return new ApiError(
    payload?.error ?? `Request failed with status ${response.status}`,
    response.status,
    payload?.code ?? null
  );
}

async function fetchWithTimeout(path: string, init: RequestInit) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), API_TIMEOUT_MS);
  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: "include",
      signal: abortController.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("Request timed out. Please try again.", 408, "REQUEST_TIMEOUT");
    }
    throw new ApiError("Could not reach API server. Check that backend is running.", 503, "API_UNREACHABLE");
  } finally {
    clearTimeout(timeoutId);
  }
}

async function refreshAccessToken() {
  if (!refreshHandler) return null;
  refreshPromise ??= refreshHandler().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function executeWithAuthRetry(
  path: string,
  options: RequestOptions,
  execute: (accessToken?: string) => Promise<Response>
) {
  let response = await execute(options.accessToken);
  if (response.status === 401 && !options.skipAuthRetry && !path.startsWith("/auth/")) {
    const accessToken = await refreshAccessToken();
    if (accessToken) response = await execute(accessToken);
  }
  if (response.status === 401 && unauthorizedHandler) unauthorizedHandler();
  return response;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await executeWithAuthRetry(path, options, (accessToken) =>
    fetchWithTimeout(path, {
      method: options.method ?? "GET",
      headers: {
        ...(typeof options.body === "undefined" ? {} : { "content-type": "application/json" }),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
      },
      body: typeof options.body === "undefined" ? undefined : JSON.stringify(options.body)
    })
  );

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function apiUpload<T>(path: string, formData: FormData, accessToken?: string): Promise<T> {
  const options: RequestOptions = { method: "POST", accessToken };
  const response = await executeWithAuthRetry(path, options, (nextToken) =>
    fetchWithTimeout(path, {
      method: "POST",
      headers: nextToken ? { authorization: `Bearer ${nextToken}` } : {},
      body: formData
    })
  );
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as T;
}

export async function apiDownload(path: string, fileName: string, accessToken?: string) {
  const options: RequestOptions = { accessToken };
  const response = await executeWithAuthRetry(path, options, (nextToken) =>
    fetchWithTimeout(path, { headers: nextToken ? { authorization: `Bearer ${nextToken}` } : {} })
  );
  if (!response.ok) throw await parseError(response);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
