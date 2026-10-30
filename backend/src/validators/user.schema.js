/**
 * src/validators/user.schema.js
 */

import { z } from "zod";

export const createUserSchema = z
  .object({
    email: z
      .string({ error: "email is required" })
      .trim()
      .toLowerCase()
      .max(254)
      .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Invalid email address"),
    password: z
      .string({ error: "password is required" })
      .min(8, "password must be at least 8 characters")
      .max(128, "password must be at most 128 characters"),
    role: z.enum(["student", "faculty", "admin"], {
      error: "role must be student, faculty or admin",
    }),
    // Required for role "student": the studentId (e.g. "SEED0001") of the
    // Student record this login belongs to. Forbidden for other roles.
    studentId: z.string().trim().toUpperCase().min(1).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.role === "student" && !d.studentId) {
      ctx.addIssue({
        code: "custom",
        message: "studentId is required when role is student",
        path: ["studentId"],
      });
    }
    if (d.role !== "student" && d.studentId) {
      ctx.addIssue({
        code: "custom",
        message: "studentId is only allowed when role is student",
        path: ["studentId"],
      });
    }
  });
