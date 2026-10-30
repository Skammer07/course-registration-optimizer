/**
 * src/services/adminBootstrap.service.js
 * One-off creation (or recovery) of an admin login, used by
 * scripts/create-admin.js. This is the supported way to get the FIRST admin in
 * production, where the development-only seed does not run.
 *
 *   - No password given: a temporary one is generated, returned once, and the
 *     admin must change it at first login.
 *   - A password given on the command line is accepted but is then visible in
 *     shell history; the generated one is recommended.
 *   - An existing admin is only touched with reset=true (new temporary
 *     password, forced change, old tokens invalidated, account re-activated).
 *     A non-admin account with that email is never converted.
 */

import User from "../models/User.js";
import { hashPassword } from "./auth.service.js";
import { generateTemporaryPassword } from "../utils/password.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function bootstrapAdmin({ email, password, reset = false }) {
  const normalized = String(email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(normalized) || normalized.length > 254) {
    throw new Error("A valid --email is required.");
  }
  if (password !== undefined && (password.length < 8 || password.length > 128)) {
    throw new Error("--password must be 8 to 128 characters (or omit it to generate one).");
  }

  const generated = password === undefined;
  const plain = generated ? generateTemporaryPassword() : password;
  const existing = await User.findOne({ email: normalized }).select("role").lean();

  if (existing) {
    if (existing.role !== "admin") {
      throw new Error(`An account with ${normalized} exists but is not an admin; it will not be changed.`);
    }
    if (!reset) {
      throw new Error(`An admin with ${normalized} already exists. Use --reset to issue a new password.`);
    }
    await User.updateOne(
      { _id: existing._id },
      {
        $set: {
          passwordHash: await hashPassword(plain),
          mustChangePassword: generated,
          passwordChangedAt: new Date(),
          isActive: true,
        },
      }
    );
    return { action: "reset", email: normalized, password: plain, mustChangePassword: generated };
  }

  await User.create({
    email: normalized,
    passwordHash: await hashPassword(plain),
    role: "admin",
    isActive: true,
    mustChangePassword: generated,
  });
  return { action: "created", email: normalized, password: plain, mustChangePassword: generated };
}
