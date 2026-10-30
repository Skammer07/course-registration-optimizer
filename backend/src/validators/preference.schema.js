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
  // admin/faculty list only: one student's lists (a student's own /me route ignores it)
  student: z.string().regex(objectIdRegex, "Invalid student id").optional(),
  electiveGroup: z.string().trim().optional(),
  status: z.enum(["draft", "submitted"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});


/** Who has submitted what, for one semester (admin/faculty). */
export const preferenceOverviewQuerySchema = z.object({
  semesterId: z.string({ error: "semesterId is required" }).trim().min(1, "semesterId is required"),
  search: z.string().trim().max(100, "Search query must be 100 characters or fewer").optional(),
  department: z.string().trim().max(100).optional(),
  status: z.enum(["all", "complete", "incomplete", "none"]).optional().default("all"),
  includeInactive: z.enum(["true", "false"]).transform((v) => v === "true").optional().default(false),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});
