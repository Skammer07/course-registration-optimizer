/**
 * src/middleware/notFound.middleware.js
 * Handles unmatched routes.
 */

import { ApiError } from "../utils/ApiError.js";

export function notFoundHandler(req, _res, next) {
  next(new ApiError(404, `Route ${req.method} ${req.originalUrl} not found`, "NOT_FOUND"));
}

