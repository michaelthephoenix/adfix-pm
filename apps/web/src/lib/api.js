const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1";
export class ApiError extends Error {
    status;
    code;
    constructor(message, status, code = null) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
export async function apiRequest(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        method: options.method ?? "GET",
        headers: {
            "content-type": "application/json",
            ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {})
        },
        body: typeof options.body === "undefined" ? undefined : JSON.stringify(options.body)
    });
    if (!response.ok) {
        let payload = null;
        try {
            payload = (await response.json());
        }
        catch {
            payload = null;
        }
        throw new ApiError(payload?.error ?? `Request failed with status ${response.status}`, response.status, payload?.code ?? null);
    }
    if (response.status === 204) {
        return undefined;
    }
    return (await response.json());
}
