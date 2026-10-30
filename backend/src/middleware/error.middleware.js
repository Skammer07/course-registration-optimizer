/**
 * src/middleware/error.middleware.js
 * Centralized error handler. Must be registered last in Express.
 */

import mongoose from "mongoose";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../utils/logger.js";

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  // Body too large (express body-parser)
  if (err.type === "entity.too.large" || err.status === 413) {
    return res.status(413).json({
      success: false,
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Request body exceeds the maximum allowed size.",
        details: [],
      },
    });
  }

  // Malformed JSON (or any other body-parser rejection) is the client's mistake.
  if (err.type === "entity.parse.failed" || (err.status === 400 && err.expose === true)) {
    return res.status(400).json({
      success: false,
      error: {
        code: "BAD_REQUEST",
        message: "The request body is not valid JSON.",
        details: [],
      },
    });
  }

  // Log internal server errors with full context (never stack trace to client).
  if (!(err instanceof ApiError) || err.statusCode >= 500) {
    logger.error(
      { err: err.message, path: req.originalUrl, method: req.method },
      "Unhandled error"
    );
  }

  // Mongoose duplicate key error → 409 Conflict
  if (err.code === 11000 && err.keyValue) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(409).json({
      success: false,
      error: {
        code: "CONFLICT",
        message: `A record with that ${field} already exists.`,
        details: [],
      },
    });
  }

  // Mongoose CastError (bad ObjectId) → 400
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({
      success: false,
      error: {
        code: "BAD_REQUEST",
        message: `Invalid value for field: ${err.path}`,
        details: [],
      },
    });
  }

  // Mongoose ValidationError → 400
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Document validation failed.",
        details,
      },
    });
  }

  // Known ApiError
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
  }

  // Unexpected errors — never leak internals
  return res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred. Please try again later.",
      details: [],
    },
  });
}

