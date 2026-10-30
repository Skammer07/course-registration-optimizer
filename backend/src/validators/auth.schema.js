/**
 * src/validators/auth.schema.js
 */

import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string({ error: "Email is required" })
    .email("Invalid email address")
    .toLowerCase(),
  password: z
    .string({ error: "Password is required" })
    .min(1, "Password is required"),
});


export const changePasswordSchema = z
  .object({
    currentPassword: z.string({ error: "currentPassword is required" }).min(1, "currentPassword is required"),
    newPassword: z
      .string({ error: "newPassword is required" })
      .min(8, "newPassword must be at least 8 characters")
      .max(128, "newPassword must be at most 128 characters"),
  })
  .strict();
