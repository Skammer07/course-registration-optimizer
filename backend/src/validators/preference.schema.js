/**
 * src/validators/preference.schema.js
 */

import { z } from "zod";

const objectIdRegex = /^[a-f\d]{24}$/i;
const objectIdSchema = z.string().regex(objectIdRegex, "Invalid course ID");

export const upsertPreferenceSchema = z.object({
  semesterId: z
    .string({ error: "semesterId is required" })
    .trim()
    .min(1, "semesterId cannot be empty"),
  electiveGroup: z
    .string({ error: "electiveGroup is required" })
    .trim()
    .min(1, "electiveGroup cannot be empty"),
  rankedCourseIds: z
    .array(objectIdSchema, { error: "rankedCourseIds is required" })
    .min(1, "At least one course must be ranked")
    .refine(
      (ids) => ids.length === new Set(ids).size,
      "Duplicate course IDs are not allowed"
    ),
  status: z.enum(["draft", "submitted"]).optional().default("draft"),
});

export const preferenceQuerySchema = z.object({
  semesterId: z.string().trim().optional(),
  electiveGroup: z.string().trim().optional(),
  status: z.enum(["draft", "submitted"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

