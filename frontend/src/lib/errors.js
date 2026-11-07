/** Turn API errors into something a person can act on. */

const KNOWN = {
  NETWORK_ERROR: {
    title: "Cannot reach the server",
    hint: "Check your connection and that the backend is running.",
  },
  UNAUTHORIZED: { title: "You are signed out", hint: "Sign in again to continue." },
  FORBIDDEN: { title: "Not allowed", hint: "Your account does not have access to this." },
  PASSWORD_CHANGE_REQUIRED: {
    title: "Change your password first",
    hint: "You are using a temporary password. Set your own to continue.",
  },
  PREFERENCES_CLOSED: {
    title: "Preferences are closed",
    hint: "Changes are not accepted outside the preference window.",
  },
  RATE_LIMITED: { title: "Too many attempts", hint: "Wait a few minutes and try again." },
  ALLOCATION_TIMEOUT: {
    title: "The run took too long and was stopped",
    hint: "Try again with the timetable check turned off, or with a smaller dataset.",
  },
  ALLOCATION_OUT_OF_MEMORY: {
    title: "The run ran out of memory and was stopped",
    hint: "Try again with the timetable check turned off, or with a smaller dataset.",
  },
  ALLOCATION_CANCELLED: { title: "The run was cancelled", hint: null },
  ALLOCATION_FAILED: {
    title: "The allocation failed",
    hint: "The run was recorded as failed. Check the input data and try again.",
  },
  IMPORT_VALIDATION_FAILED: {
    title: "The file has problems",
    hint: "Nothing was imported. Fix the rows listed below and upload again.",
  },
  PUBLICATION_VALIDATION_FAILED: {
    title: "These results cannot be published",
    hint: "The stored results failed validation. Nothing was published.",
  },
  INVALID_CURRENT_PASSWORD: { title: "Current password is incorrect", hint: null },
};

/**
 * @param {unknown} error
 * @returns {{ title: string, message: string, hint: string|null, details: string[], requestId: string|null, code: string }}
 */
export function describeError(error) {
  const code = error?.code ?? "UNKNOWN";
  const known = KNOWN[code];
  const details = (Array.isArray(error?.details) ? error.details : [])
    .map(formatDetail)
    .filter(Boolean);

  return {
    code,
    title: known?.title ?? "Something went wrong",
    message: error?.message || "An unexpected error occurred.",
    hint: known?.hint ?? null,
    details,
    requestId: error?.requestId ?? null,
  };
}

/** Validation details come as strings, {field,message} or {row,column,message}. */
function formatDetail(detail) {
  if (typeof detail === "string") return detail;
  if (!detail || typeof detail !== "object") return null;
  const where = detail.row != null ? `Row ${detail.row}${detail.column ? `, ${detail.column}` : ""}` : detail.field ?? detail.path;
  const message = detail.message ?? "";
  if (!message) return null;
  return where ? `${where}: ${message}` : message;
}
