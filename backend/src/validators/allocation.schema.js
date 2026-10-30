/**
 * src/validators/allocation.schema.js
 *
 * compareAllocationSchema validates:
 *   - meritRatio and randomRatio each in [0, 1]
 *   - meritRatio + randomRatio must equal 1.0 (within floating-point tolerance)
 *     The algorithm uses meritRatio to split capacity into merit-based and
 *     random seats; they must sum to 1 to avoid lost capacity.
 *   - publishAllocationSchema requires an explicit algorithm selection so the
 *     admin must choose which result set to publish (optimized or baseline).
 */

import { z } from "zod";

export const compareAllocationSchema = z
  .object({
    semesterId: z
      .string({ error: "semesterId is required" })
      .trim()
      .min(1, "semesterId cannot be empty"),
    maxCoursesPerStudent: z
      .number()
      .int("maxCoursesPerStudent must be an integer")
      .min(1, "maxCoursesPerStudent must be at least 1")
      .optional()
      .default(2),
    meritRatio: z
      .number()
      .finite("meritRatio must be a finite number")
      .min(0, "meritRatio must be >= 0")
      .max(1, "meritRatio must be <= 1")
      .optional()
      .default(0.75),
    randomRatio: z
      .number()
      .finite("randomRatio must be a finite number")
      .min(0, "randomRatio must be >= 0")
      .max(1, "randomRatio must be <= 1")
      .optional()
      .default(0.25),
    includeTimetable: z.boolean().optional().default(true),
    // Optional seed for the baseline lottery; omitted -> a seed is generated
    // and stored on the run so the baseline can be reproduced.
    seed: z.number().int().min(0).max(4294967295).optional(),
  })
  .refine(
    (data) => Math.abs(data.meritRatio + data.randomRatio - 1.0) < 1e-9,
    {
      message: "meritRatio and randomRatio must sum to exactly 1.0",
      path: ["randomRatio"],
    }
  );

/**
 * Run ONE selected algorithm. Ratios and seed apply to the baseline only;
 * the optimizer ignores them. Baseline ratios must sum to 1 when given.
 */
export const runSingleAllocationSchema = z
  .object({
    semesterId: z
      .string({ error: "semesterId is required" })
      .trim()
      .min(1, "semesterId cannot be empty"),
    algorithm: z.enum(["baseline", "optimized"], {
      error: "algorithm is required: choose 'baseline' or 'optimized'",
    }),
    maxCoursesPerStudent: z
      .number()
      .int("maxCoursesPerStudent must be an integer")
      .min(1, "maxCoursesPerStudent must be at least 1")
      .optional()
      .default(2),
    meritRatio: z.number().finite().min(0).max(1).optional(),
    randomRatio: z.number().finite().min(0).max(1).optional(),
    includeTimetable: z.boolean().optional().default(true),
    seed: z.number().int().min(0).max(4294967295).optional(),
  })
  .superRefine((d, ctx) => {
    const hasBaselineOnly =
      d.meritRatio !== undefined || d.randomRatio !== undefined || d.seed !== undefined;
    if (d.algorithm === "optimized" && hasBaselineOnly) {
      ctx.addIssue({
        code: "custom",
        message: "meritRatio, randomRatio and seed apply to the baseline only",
        path: ["algorithm"],
      });
    }
    if (d.algorithm === "baseline") {
      const m = d.meritRatio ?? 0.75;
      const r = d.randomRatio ?? 1 - m;
      if (Math.abs(m + r - 1) > 1e-9) {
        ctx.addIssue({
          code: "custom",
          message: "meritRatio and randomRatio must sum to exactly 1.0",
          path: ["randomRatio"],
        });
      }
    }
  });

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid run id");
const algorithmEnum = z.enum(["baseline", "optimized"]);

/** Query for comparing two stored runs side by side. */
export const compareRunsQuerySchema = z.object({
  runA: objectId,
  runB: objectId,
  algorithmA: algorithmEnum.optional(),
  algorithmB: algorithmEnum.optional(),
});

export const runQuerySchema = z.object({
  semesterId: z.string().trim().optional(),
  status: z
    .enum(["pending", "running", "completed", "failed", "cancelled", "publishing", "published"])
    .optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  algorithm: algorithmEnum.optional(),
});

export const runResultsQuerySchema = z.object({
  algorithm: z.enum(["baseline", "optimized"]).optional(),
  // Optional filters: baseline phase, preference rank, one course, one student
  phase: z.enum(["merit", "random"]).optional(),
  rank: z.coerce.number().int().min(1).optional(),
  courseCode: z.string().trim().min(1).max(50).optional(),
  studentId: z.string().trim().min(1).max(50).optional(),
  // default: algorithm then rank; "rank" / "-rank": by preference rank; "phase"
  sort: z.enum(["default", "rank", "-rank", "phase"]).optional().default("default"),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
});

/** Replay check: verify one algorithm, or both when omitted. */
export const verifyRunQuerySchema = z.object({
  algorithm: algorithmEnum.optional(),
});

/** CSV export of one algorithm's assignments. */
export const exportRunQuerySchema = z.object({
  algorithm: algorithmEnum.optional(),
});

/** Dashboard views (admin/faculty). algorithm may be omitted when the run is published or holds one algorithm. */
export const byStudentQuerySchema = z.object({
  algorithm: algorithmEnum.optional(),
  search: z.string().trim().max(100).optional(),
  status: z.enum(["all", "allocated", "unallocated"]).optional().default("all"),
  sort: z.enum(["studentId", "name", "cgpa", "coursesAllocated", "averageRank"]).optional().default("studentId"),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export const byCourseQuerySchema = z.object({
  algorithm: algorithmEnum.optional(),
  search: z.string().trim().max(100).optional(),
  sort: z.enum(["courseCode", "utilization", "assignedCount", "demand"]).optional().default("courseCode"),
  includeStudents: z.enum(["true", "false"]).transform((v) => v === "true").optional().default(true),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

/**
 * Schema for the publish endpoint body.
 * Admin must explicitly select which algorithm's results to publish.
 */
export const publishAllocationSchema = z.object({
  algorithm: z.enum(["baseline", "optimized"], {
    error: "algorithm is required: choose 'baseline' or 'optimized'",
  }),
});

