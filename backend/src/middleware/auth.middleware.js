/**
 * src/middleware/auth.middleware.js
 * Verifies the JWT in the HTTP-only cookie and attaches req.user.
 */

import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import User from "../models/User.js";

function buildRequireAuth({ allowPasswordChange }) {
  return asyncHandler(async (req, _res, next) => {
    const token = req.cookies?.token;

    if (!token) {
      throw ApiError.unauthorized("No authentication token provided.");
    }

    let payload;
    try {
      payload = jwt.verify(token, env.jwtSecret);
    } catch {
      throw ApiError.unauthorized("Invalid or expired token.");
    }

    const user = await User.findById(payload.sub).select("-passwordHash").lean();

    if (!user) {
      throw ApiError.unauthorized("User account no longer exists.");
    }

    if (!user.isActive) {
      throw ApiError.unauthorized("User account is deactivated.");
    }

    // A password change/reset invalidates every token issued before it.
    if (user.passwordChangedAt) {
      const changedAtSeconds = Math.floor(new Date(user.passwordChangedAt).getTime() / 1000);
      if (typeof payload.iat === "number" && payload.iat < changedAtSeconds) {
        throw ApiError.unauthorized("Your password was changed. Please log in again.");
      }
    }

    // A temporary password must be replaced before anything else is allowed.
    if (user.mustChangePassword && !allowPasswordChange) {
      throw new ApiError(
        403,
        "You must change your temporary password before continuing.",
        "PASSWORD_CHANGE_REQUIRED"
      );
    }

    req.user = user;
    next();
  });
}

/** Normal protected routes: blocked while a temporary password is in place. */
export const requireAuth = buildRequireAuth({ allowPasswordChange: false });

/** Only for /auth/me and /auth/change-password. */
export const requireAuthAllowPasswordChange = buildRequireAuth({ allowPasswordChange: true });

