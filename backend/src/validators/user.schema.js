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
    // Optional: when omitted the server generates a temporary password,
    // returns it once, and the user must change it at first login.
    password: z
      .string()
      .min(8, "password must be at least 8 characters")
      .max(128, "password must be at most 128 characters")
      .optional(),
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

export const listUsersQuerySchema = z.object({
  role: z.enum(["student", "faculty", "admin"]).optional(),
  isActive: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  search: z.string().trim().max(100, "Search query must be 100 characters or fewer").optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export const setUserStatusSchema = z
  .object({ isActive: z.boolean({ error: "isActive must be true or false" }) })
  .strict();
