/**
 * Thin fetch wrapper for the backend API.
 *  - Cookies carry the session, so every call sends credentials.
 *  - Success bodies are { success, message, data }; this returns `data`.
 *  - Failures become ApiError { status, code, message, details, requestId }.
 *  - A 401 on a normal call tells the app the session ended (see setUnauthorizedHandler).
 */

const BASE = (import.meta.env?.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor({ status, code, message, details = [], requestId = null }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

let unauthorizedHandler = null;

/** Called with the ApiError whenever a request (other than login / session check) gets a 401. */
export function setUnauthorizedHandler(handler) {
  unauthorizedHandler = handler;
}

export function buildUrl(path, query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return `${BASE}${path}${qs ? `?${qs}` : ""}`;
}

function filenameFrom(disposition) {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? "");
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * @param {string} path  e.g. "/api/v1/auth/me"
 * @param {{ method?: string, query?: object, body?: unknown, textBody?: string, responseType?: "json"|"blob",
 *           handle401?: boolean }} [options]  body is sent as JSON; textBody as text/csv (file uploads)
 */
export async function request(path, { method = "GET", query, body, textBody, responseType = "json", handle401 = true } = {}) {
  let response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      credentials: "include",
      headers:
        body !== undefined ? { "Content-Type": "application/json" } : textBody !== undefined ? { "Content-Type": "text/csv" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : textBody,
    });
  } catch {
    throw new ApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: "Cannot reach the server.",
    });
  }

  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      /* not JSON (proxy error page, etc.) */
    }
    const error = new ApiError({
      status: response.status,
      code: payload?.error?.code ?? `HTTP_${response.status}`,
      message: payload?.error?.message ?? `The server answered ${response.status}.`,
      details: payload?.error?.details ?? [],
      requestId: payload?.requestId ?? response.headers.get("x-request-id"),
    });
    if (response.status === 401 && handle401 && unauthorizedHandler) unauthorizedHandler(error);
    throw error;
  }

  if (responseType === "blob") {
    return {
      blob: await response.blob(),
      filename: filenameFrom(response.headers.get("content-disposition")),
    };
  }
  if (response.status === 204) return null;
  const payload = await response.json();
  return payload && "data" in payload ? payload.data : payload;
}
