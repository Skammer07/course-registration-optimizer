/**
 * src/validators/student.schema.js
 *
 * Search queries are limited to 100 characters to prevent excessively long
 * inputs that could cause slow regex scans in MongoDB.
 */

import { z } from "zod";

const studentBase = z.object({
  studentId: z
    .string({ error: "studentId is required" })
    .trim()
    .toUpperCase()
    .min(1, "studentId cannot be empty"),
  name: z
    .string({ error: "Name is required" })
    .trim()
    .min(1, "Name cannot be empty"),
  cgpa: z
    .number({ error: "CGPA is required" })
    .min(0, "CGPA cannot be negative")
    .max(10, "CGPA cannot exceed 10"),
  department: z.string().trim().optional(),
  semesterId: z.string().trim().optional(),
  electiveGroups: z.array(z.string().trim()).optional(),
  isActive: z.boolean().optional(),
});

// Defaults apply on CREATE only. They must not be part of the update schema:
// zod 4 applies .default() inside .partial(), so a PATCH of one field would
// otherwise silently reset every defaulted field.
export const createStudentSchema = studentBase.extend({
  department: z.string().trim().optional().default(""),
  semesterId: z.string().trim().optional().default(""),
  electiveGroups: z.array(z.string().trim()).optional().default([]),
  isActive: z.boolean().optional().default(true),
});

export const updateStudentSchema = studentBase
  .partial()
  .omit({ studentId: true }); // studentId must not change

export const studentQuerySchema = z.object({
  semesterId: z.string().trim().optional(),
  department: z.string().trim().max(100, "Department filter must be 100 characters or fewer").optional(),
  search: z.string().trim().max(100, "Search query must be 100 characters or fewer").optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

