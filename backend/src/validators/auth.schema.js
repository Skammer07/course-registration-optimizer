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

