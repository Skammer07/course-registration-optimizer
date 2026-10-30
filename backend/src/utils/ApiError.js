/**
 * src/utils/ApiError.js
 * Custom error class for structured HTTP error responses.
 */

export class ApiError extends Error {
  /**
   * @param {number} statusCode   HTTP status code
   * @param {string} message      Human-readable message
   * @param {string} code         Machine-readable error code
   * @param {Array}  details      Optional validation detail array
   */
  constructor(statusCode, message, code = "INTERNAL_ERROR", details = []) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }

  static badRequest(message, details = []) {
    return new ApiError(400, message, "BAD_REQUEST", details);
  }

  static unauthorized(message = "Authentication required") {
    return new ApiError(401, message, "UNAUTHORIZED");
  }

  static forbidden(message = "Insufficient permissions") {
    return new ApiError(403, message, "FORBIDDEN");
  }

  static notFound(resource = "Resource") {
    return new ApiError(404, `${resource} not found`, "NOT_FOUND");
  }

  static conflict(message) {
    return new ApiError(409, message, "CONFLICT");
  }

  static validation(message, details = []) {
    return new ApiError(400, message, "VALIDATION_ERROR", details);
  }
}

