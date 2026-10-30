/**
 * src/services/user.service.js
 * Admin-managed creation of login accounts.
 *
 * There is no public signup: only an admin can create accounts, and a student
 * account is always bound to exactly one existing Student record (so a login
 * can never act for a student it was not linked to).
 */

import User from "../models/User.js";
import Student from "../models/Student.js";
import { hashPassword } from "./auth.service.js";
import { ApiError } from "../utils/ApiError.js";

/** Public view of a user: never includes the password hash. */
function publicUser(user) {
  return {
    _id: user._id,
    email: user.email,
    role: user.role,
    student: user.student ?? null,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}

export async function createUser({ email, password, role, studentId }) {
  let studentObjectId = null;

  if (role === "student") {
    const student = await Student.findOne({ studentId }).select("_id").lean();
    if (!student) {
      throw ApiError.badRequest(`No student record found with studentId "${studentId}".`);
    }
    const taken = await User.exists({ student: student._id });
    if (taken) {
      throw ApiError.conflict(`A login already exists for student "${studentId}".`);
    }
    studentObjectId = student._id;
  }

  const passwordHash = await hashPassword(password);
  // Duplicate emails surface as a Mongo 11000 error -> 409 via the error middleware.
  const user = await User.create({
    email,
    passwordHash,
    role,
    student: studentObjectId,
    isActive: true,
  });

  return publicUser(user.toObject());
}
