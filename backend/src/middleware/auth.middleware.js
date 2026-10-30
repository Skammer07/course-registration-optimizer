/**
 * src/middleware/auth.middleware.js
 * Verifies the JWT in the HTTP-only cookie and attaches req.user.
 */

import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import User from "../models/User.js";

export const requireAuth = asyncHandler(async (req, _res, next) => {
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

  req.user = user;
  next();
});

