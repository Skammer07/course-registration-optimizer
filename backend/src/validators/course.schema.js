/**
 * src/validators/course.schema.js
 *
 * Timetable slot validation:
 *  - day must be a valid weekday
 *  - start/end must be HH:MM with valid hour (00-23) and minute (00-59)
 *  - start must be strictly before end
 *
 * Search query is limited to 100 characters to prevent excessively long
 * inputs that could cause slow regex scans.
 */

import { z } from "zod";
import { WEEKDAYS, isValidTime, isValidSlot } from "../utils/timetable.js";
import { COURSE_KINDS, courseKindProblem } from "../utils/courseKind.js";

const timeString = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "Time must be HH:MM")
  .refine(isValidTime, {
    message: "Time must have a valid hour (00-23) and minute (00-59)",
  });

const timetableSlotSchema = z
  .object({
    day: z.enum(WEEKDAYS),
    start: timeString,
    end: timeString,
  })
  .refine(
    (slot) => isValidSlot(slot),
    { message: "Slot start time must be earlier than end time" }
  );

const courseBase = z.object({
  courseCode: z
    .string({ error: "courseCode is required" })
    .trim()
    .toUpperCase()
    .min(1, "courseCode cannot be empty"),
  title: z
    .string({ error: "Title is required" })
    .trim()
    .min(1, "Title cannot be empty"),
  // Required for electives (checked on create); compulsory courses have no seats
  capacity: z
    .number({ error: "Capacity is required" })
    .int("Capacity must be an integer")
    .min(0, "Capacity cannot be negative")
    .optional(),
  kind: z.enum(COURSE_KINDS, { error: "kind must be elective or compulsory" }).optional(),
  departments: z.array(z.string().trim().min(1, "A department cannot be empty")).optional(),
  semesterId: z
    .string({ error: "semesterId is required" })
    .trim()
    .min(1, "semesterId cannot be empty"),
  electiveGroup: z.string().trim().nullable().optional(),
  timetableSlots: z.array(timetableSlotSchema).optional(),
  isActive: z.boolean().optional(),
});

// Defaults apply on CREATE only (zod 4 applies .default() inside .partial(),
// which would reset these fields on every PATCH).
export const createCourseSchema = courseBase
  .extend({
    kind: z.enum(COURSE_KINDS, { error: "kind must be elective or compulsory" }).optional().default("elective"),
    departments: z.array(z.string().trim().min(1, "A department cannot be empty")).optional().default([]),
    electiveGroup: z.string().trim().nullable().optional().default(null),
    timetableSlots: z.array(timetableSlotSchema).optional().default([]),
    isActive: z.boolean().optional().default(true),
  })
  .superRefine((course, ctx) => {
    if (course.kind === "elective" && course.capacity === undefined) {
      ctx.addIssue({ code: "custom", path: ["capacity"], message: "Capacity is required" });
    }
    const problem = courseKindProblem(course);
    if (problem) ctx.addIssue({ code: "custom", path: ["kind"], message: problem });
  });

export const updateCourseSchema = courseBase
  .partial()
  .omit({ courseCode: true, semesterId: true });

export const courseQuerySchema = z.object({
  semesterId: z.string().trim().optional(),
  electiveGroup: z.string().trim().optional(),
  kind: z.enum(COURSE_KINDS).optional(),
  search: z.string().trim().max(100, "Search query must be 100 characters or fewer").optional(),
  isActive: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

