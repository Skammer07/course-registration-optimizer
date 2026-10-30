/**
 * src/controllers/auth.controller.js
 */

import { asyncHandler } from "../utils/asyncHandler.js";
import { loginUser, changeOwnPassword } from "../services/auth.service.js";
import { success } from "../utils/respond.js";
import { env } from "../config/env.js";
import { durationToMs } from "../utils/duration.js";

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: env.isProduction ? "strict" : "lax",
  secure: env.isProduction,
  maxAge: durationToMs(env.jwtExpiresIn), // always matches the JWT lifetime
};

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { token, user } = await loginUser(email, password);

  res.cookie("token", token, COOKIE_OPTIONS);

  return success(res, { user }, "Logged in successfully");
});

export const logout = asyncHandler(async (_req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    sameSite: env.isProduction ? "strict" : "lax",
    secure: env.isProduction,
  });
  return success(res, null, "Logged out successfully");
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const { token } = await changeOwnPassword(req.user._id, currentPassword, newPassword);
  // The old token is now invalid; hand back a fresh one.
  res.cookie("token", token, COOKIE_OPTIONS);
  return success(res, null, "Password changed");
});

export const me = asyncHandler(async (req, res) => {
  return success(res, { user: req.user }, "Current user retrieved");
});
