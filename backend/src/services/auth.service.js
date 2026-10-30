/**
 * src/services/auth.service.js
 * Business logic for authentication.
 */

import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { ApiError } from "../utils/ApiError.js";
import User from "../models/User.js";
import { logger } from "../utils/logger.js";

/** Argon2id configuration */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
};

export async function hashPassword(plaintext) {
  return argon2.hash(plaintext, ARGON2_OPTIONS);
}

export async function verifyPassword(hash, plaintext) {
  return argon2.verify(hash, plaintext);
}

export function signToken(userId, role) {
  return jwt.sign({ sub: userId.toString(), role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

/**
 * Authenticate a user by email+password.
 * Returns the user document (without hash) and a signed JWT.
 */
export async function loginUser(email, password) {
  // Fetch the user including the hash (select: false field)
  const user = await User.findOne({ email: email.toLowerCase() })
    .select("+passwordHash")
    .lean();

  // Use constant-time comparison even for missing user (prevent timing attacks)
  const DUMMY_HASH =
    "$argon2id$v=19$m=65536,t=3,p=1$dummydummydummy$dummydummydummydummydummydummydummydummy";

  const hashToVerify = user?.passwordHash ?? DUMMY_HASH;
  let passwordValid = false;

  try {
    passwordValid = await argon2.verify(hashToVerify, password);
  } catch {
    passwordValid = false;
  }

  if (!user || !passwordValid) {
    throw ApiError.unauthorized("Invalid email or password.");
  }

  if (!user.isActive) {
    throw ApiError.unauthorized("This account has been deactivated.");
  }

  const token = signToken(user._id, user.role);
  const { passwordHash: _omit, ...safeUser } = user;

  logger.info({ userId: user._id, role: user.role }, "User logged in");

  return { token, user: safeUser };
}

/**
 * Development-only: seed the first admin account if it does not exist.
 * This function is a no-op in production.
 */
export async function seedAdminIfNeeded() {
  if (!env.isDevelopment) return;

  const { seedAdminEmail, seedAdminPassword } = env;
  if (!seedAdminEmail || !seedAdminPassword) return;

  const exists = await User.exists({ email: seedAdminEmail.toLowerCase() });
  if (exists) return;

  const passwordHash = await hashPassword(seedAdminPassword);
  await User.create({
    email: seedAdminEmail.toLowerCase(),
    passwordHash,
    role: "admin",
    isActive: true,
  });

  logger.info({ email: seedAdminEmail }, "Development admin account seeded");
}

