/**
 * tests/unit/auditFixes.test.js
 * Regression tests for the backend audit fixes: zod-4 partial/default
 * behaviour, cookie lifetime, env hardening, schema completeness.
 */

import { describe, it, expect } from "vitest";
import { updateStudentSchema, createStudentSchema } from "../../src/validators/student.schema.js";
import { updateCourseSchema, createCourseSchema } from "../../src/validators/course.schema.js";
import { runSingleAllocationSchema, publishAllocationSchema } from "../../src/validators/allocation.schema.js";
import { durationToMs } from "../../src/utils/duration.js";
import AllocationRun from "../../src/models/AllocationRun.js";

describe("PATCH schemas never inject defaults (a partial update must not reset other fields)", () => {
  it("student", () => {
    expect(updateStudentSchema.parse({ name: "X" })).toEqual({ name: "X" });
    expect(updateStudentSchema.parse({})).toEqual({});
  });
  it("course", () => {
    expect(updateCourseSchema.parse({ title: "T" })).toEqual({ title: "T" });
    expect(updateCourseSchema.parse({})).toEqual({});
  });
  it("create schemas still apply their defaults", () => {
    expect(createStudentSchema.parse({ studentId: "a", name: "n", cgpa: 8 })).toMatchObject({
      studentId: "A", department: "", semesterId: "", electiveGroups: [], isActive: true,
    });
    expect(createCourseSchema.parse({ courseCode: "c", title: "t", capacity: 1, semesterId: "s" })).toMatchObject({
      courseCode: "C", electiveGroup: null, timetableSlots: [], isActive: true,
    });
  });
});

describe("custom validation messages survive the zod 4 upgrade", () => {
  it("missing algorithm uses our message", () => {
    const r = runSingleAllocationSchema.safeParse({ semesterId: "S" });
    expect(r.error.issues[0].message).toMatch(/algorithm is required/);
    const p = publishAllocationSchema.safeParse({});
    expect(p.error.issues[0].message).toMatch(/algorithm is required/);
  });
  it("missing student fields use our messages", () => {
    const r = createStudentSchema.safeParse({});
    const msgs = r.error.issues.map((i) => i.message).join("|");
    expect(msgs).toMatch(/studentId is required/);
    expect(msgs).toMatch(/Name is required/);
    expect(msgs).toMatch(/CGPA is required/);
  });
});

describe("durationToMs (cookie lifetime follows JWT_EXPIRES_IN)", () => {
  it.each([
    ["15m", 900_000], ["2h", 7_200_000], ["7d", 604_800_000], ["30s", 30_000], ["60", 60_000], [90, 90_000],
  ])("%s -> %s", (input, ms) => expect(durationToMs(input)).toBe(ms));
  it.each(["", "abc", "-5m", "0", null, undefined])("falls back for invalid %s", (v) => {
    expect(durationToMs(v)).toBe(15 * 60_000);
  });
});

describe("AllocationRun stored metrics schema keeps every calculated metric", () => {
  it("includes rank2Assignments, invalidAssignments and assignmentsWithPreferences", () => {
    const run = new AllocationRun({
      semesterId: "S", createdBy: "507f1f77bcf86cd799440002",
      baselineMetrics: { totalAssignments: 3, rank2Assignments: 1, invalidAssignments: 0, assignmentsWithPreferences: 3 },
    });
    expect(run.baselineMetrics.rank2Assignments).toBe(1);
    expect(run.baselineMetrics.invalidAssignments).toBe(0);
    expect(run.baselineMetrics.assignmentsWithPreferences).toBe(3);
  });
});
