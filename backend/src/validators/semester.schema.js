/**
 * src/validators/semester.schema.js
 */

import { z } from "zod";

const dateOrNull = z.union([z.coerce.date(), z.null()]);

const windowRefine = (d, ctx) => {
  if (d.preferencesOpenAt && d.preferencesCloseAt && d.preferencesCloseAt <= d.preferencesOpenAt) {
    ctx.addIssue({
      code: "custom",
      path: ["preferencesCloseAt"],
      message: "preferencesCloseAt must be after preferencesOpenAt",
    });
  }
};

export const createSemesterSchema = z
  .object({
    semesterId: z.string({ error: "semesterId is required" }).trim().min(1, "semesterId cannot be empty"),
    name: z.string().trim().max(100).optional(),
    preferencesOpenAt: dateOrNull.optional(),
    preferencesCloseAt: dateOrNull.optional(),
  })
  .strict()
  .superRefine(windowRefine);

// PATCH schemas never inject defaults (zod 4 would reset omitted fields).
export const updateSemesterSchema = z
  .object({
    name: z.string().trim().max(100).optional(),
    preferencesOpenAt: dateOrNull.optional(),
    preferencesCloseAt: dateOrNull.optional(),
  })
  .strict()
  .superRefine(windowRefine)
  .refine((d) => Object.keys(d).length > 0, "At least one field is required");

export const preferencesStateSchema = z
  .object({
    state: z.enum(["open", "closed", "auto"], { error: "state must be 'open', 'closed' or 'auto'" }),
  })
  .strict();
