/**
 * src/utils/respond.js
 * Helpers for consistent JSON response envelopes.
 */

export function success(res, data, message = "OK", statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}

export function created(res, data, message = "Created") {
  return success(res, data, message, 201);
}

