/**
 * tests/unit/validators.test.js
 * Unit tests for all Zod validator schemas.
 *
 * Covers new validations added in the audit:
 *  - meritRatio + randomRatio must sum to 1.0
 *  - timetable start < end, valid hour/minute ranges
 *  - search query max length (100 chars)
 *  - publishAllocationSchema algorithm selection
 */

import { describe, it, expect } from "vitest";
import { loginSchema } from "../../src/validators/auth.schema.js";
import {
  createStudentSchema,
  updateStudentSchema,
  studentQuerySchema,
} from "../../src/validators/student.schema.js";
import {
  createCourseSchema,
  updateCourseSchema,
  courseQuerySchema,
} from "../../src/validators/course.schema.js";
import {
  upsertPreferenceSchema,
} from "../../src/validators/preference.schema.js";
import {
  compareAllocationSchema,
  publishAllocationSchema,
} from "../../src/validators/allocation.schema.js";

// ── Auth schema ──────────────────────────────────────────────────────────────
describe("loginSchema", () => {
  it("accepts valid email and password", () => {
    const result = loginSchema.safeParse({ email: "Admin@Test.COM", password: "secret" });
    expect(result.success).toBe(true);
    expect(result.data.email).toBe("admin@test.com"); // lowercased
  });

  it("rejects missing password", () => {
    const result = loginSchema.safeParse({ email: "a@b.com" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid email format", () => {
    const result = loginSchema.safeParse({ email: "not-an-email", password: "x" });
    expect(result.success).toBe(false);
  });

  it("rejects empty password", () => {
    const result = loginSchema.safeParse({ email: "a@b.com", password: "" });
    expect(result.success).toBe(false);
  });
});

// ── Student schema ───────────────────────────────────────────────────────────
describe("createStudentSchema", () => {
  const validStudent = {
    studentId: "20je0001",
    name: "Aarav Kumar",
    cgpa: 9.5,
    department: "CSE",
    semesterId: "SEM2026A",
  };

  it("accepts valid student data and uppercases studentId", () => {
    const result = createStudentSchema.safeParse(validStudent);
    expect(result.success).toBe(true);
    expect(result.data.studentId).toBe("20JE0001");
  });

  it("rejects CGPA > 10", () => {
    const result = createStudentSchema.safeParse({ ...validStudent, cgpa: 10.1 });
    expect(result.success).toBe(false);
  });

  it("rejects negative CGPA", () => {
    const result = createStudentSchema.safeParse({ ...validStudent, cgpa: -0.1 });
    expect(result.success).toBe(false);
  });

  it("rejects missing name", () => {
    const result = createStudentSchema.safeParse({ ...validStudent, name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing studentId", () => {
    const { studentId: _omit, ...rest } = validStudent;
    const result = createStudentSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects non-numeric cgpa", () => {
    const result = createStudentSchema.safeParse({ ...validStudent, cgpa: "nine" });
    expect(result.success).toBe(false);
  });
});

describe("updateStudentSchema", () => {
  it("accepts partial update (only cgpa)", () => {
    const result = updateStudentSchema.safeParse({ cgpa: 8.0 });
    expect(result.success).toBe(true);
  });

  it("rejects if studentId is provided (immutable field)", () => {
    // studentId is omitted from the update schema — extra keys should be stripped
    const result = updateStudentSchema.safeParse({ studentId: "S999", cgpa: 8.0 });
    // Zod strips unknown keys — studentId is just ignored, cgpa is valid
    expect(result.success).toBe(true);
    expect(result.data.studentId).toBeUndefined();
  });

  it("rejects invalid CGPA in update", () => {
    const result = updateStudentSchema.safeParse({ cgpa: 11 });
    expect(result.success).toBe(false);
  });
});

describe("studentQuerySchema", () => {
  it("applies default page and limit", () => {
    const result = studentQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data.page).toBe(1);
    expect(result.data.limit).toBe(50);
  });

  it("coerces string page to number", () => {
    const result = studentQuerySchema.safeParse({ page: "3", limit: "20" });
    expect(result.success).toBe(true);
    expect(result.data.page).toBe(3);
    expect(result.data.limit).toBe(20);
  });

  it("rejects limit > 200", () => {
    const result = studentQuerySchema.safeParse({ limit: "999" });
    expect(result.success).toBe(false);
  });

  it("rejects search query exceeding 100 characters", () => {
    const result = studentQuerySchema.safeParse({ search: "a".repeat(101) });
    expect(result.success).toBe(false);
  });

  it("accepts search query of exactly 100 characters", () => {
    const result = studentQuerySchema.safeParse({ search: "a".repeat(100) });
    expect(result.success).toBe(true);
  });
});

// ── Course schema ─────────────────────────────────────────────────────────────
describe("createCourseSchema", () => {
  const validCourse = {
    courseCode: "cs301",
    title: "Data Structures",
    capacity: 60,
    semesterId: "SEM2026A",
    electiveGroup: "A",
  };

  it("accepts valid course and uppercases courseCode", () => {
    const result = createCourseSchema.safeParse(validCourse);
    expect(result.success).toBe(true);
    expect(result.data.courseCode).toBe("CS301");
  });

  it("rejects negative capacity", () => {
    const result = createCourseSchema.safeParse({ ...validCourse, capacity: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer capacity", () => {
    const result = createCourseSchema.safeParse({ ...validCourse, capacity: 30.5 });
    expect(result.success).toBe(false);
  });

  it("accepts capacity of 0 (course with no seats)", () => {
    const result = createCourseSchema.safeParse({ ...validCourse, capacity: 0 });
    expect(result.success).toBe(true);
  });

  it("rejects missing semesterId", () => {
    const { semesterId: _omit, ...rest } = validCourse;
    const result = createCourseSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  // ── Timetable slot validation ─────────────────────────────────────────────

  it("accepts timetable slots with valid day/time", () => {
    const result = createCourseSchema.safeParse({
      ...validCourse,
      timetableSlots: [{ day: "Monday", start: "09:00", end: "09:50" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts boundary times 00:00 and 23:59", () => {
    const result = createCourseSchema.safeParse({
      ...validCourse,
      timetableSlots: [{ day: "Friday", start: "00:00", end: "23:59" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects timetable slot with invalid day", () => {
    const result = createCourseSchema.safeParse({
      ...validCourse,
      timetableSlots: [{ day: "Funday", start: "09:00", end: "09:50" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects timetable slot with malformed time (missing leading zero)", () => {
    const result = createCourseSchema.safeParse({
      ...validCourse,
      timetableSlots: [{ day: "Monday", start: "9:00", end: "9:50" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects hour > 23 (e.g. 29:00)", () => {
    const result = createCourseSchema.safeParse({
      ...validCourse,
      timetableSlots: [{ day: "Monday", start: "29:00", end: "30:00" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects minute > 59 (e.g. 09:90)", () => {
    const result = createCourseSchema.safeParse({
      ...validCourse,
      timetableSlots: [{ day: "Monday", start: "09:90", end: "10:00" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects slot where start == end (zero-length class)", () => {
    const result = createCourseSchema.safeParse({
      ...validCourse,
      timetableSlots: [{ day: "Monday", start: "09:00", end: "09:00" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects slot where start is after end", () => {
    const result = createCourseSchema.safeParse({
      ...validCourse,
      timetableSlots: [{ day: "Monday", start: "10:00", end: "09:00" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects search query exceeding 100 characters in courseQuerySchema", () => {
    const result = courseQuerySchema.safeParse({ search: "x".repeat(101) });
    expect(result.success).toBe(false);
  });
});

// ── Preference schema ─────────────────────────────────────────────────────────
describe("upsertPreferenceSchema", () => {
  const validObjectId = "507f1f77bcf86cd799439011";
  const validPref = {
    semesterId: "SEM2026A",
    electiveGroup: "A",
    rankedCourseIds: [validObjectId, "507f1f77bcf86cd799439012"],
    status: "submitted",
  };

  it("accepts a valid preference list", () => {
    const result = upsertPreferenceSchema.safeParse(validPref);
    expect(result.success).toBe(true);
  });

  it("rejects duplicate course IDs", () => {
    const result = upsertPreferenceSchema.safeParse({
      ...validPref,
      rankedCourseIds: [validObjectId, validObjectId],
    });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toMatch(/duplicate/i);
  });

  it("rejects empty rankedCourseIds", () => {
    const result = upsertPreferenceSchema.safeParse({ ...validPref, rankedCourseIds: [] });
    expect(result.success).toBe(false);
  });

  it("rejects invalid ObjectId format", () => {
    const result = upsertPreferenceSchema.safeParse({
      ...validPref,
      rankedCourseIds: ["not-a-valid-id"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status value", () => {
    const result = upsertPreferenceSchema.safeParse({ ...validPref, status: "approved" });
    expect(result.success).toBe(false);
  });

  it("defaults status to 'draft'", () => {
    const { status: _omit, ...rest } = validPref;
    const result = upsertPreferenceSchema.safeParse(rest);
    expect(result.success).toBe(true);
    expect(result.data.status).toBe("draft");
  });
});

// ── Allocation schema ─────────────────────────────────────────────────────────
describe("compareAllocationSchema", () => {
  const validBody = {
    semesterId: "SEM2026A",
    maxCoursesPerStudent: 2,
    meritRatio: 0.75,
    randomRatio: 0.25,
  };

  it("accepts valid comparison request", () => {
    const result = compareAllocationSchema.safeParse(validBody);
    expect(result.success).toBe(true);
  });

  it("applies defaults when optional fields are omitted", () => {
    const result = compareAllocationSchema.safeParse({ semesterId: "SEM2026A" });
    expect(result.success).toBe(true);
    expect(result.data.maxCoursesPerStudent).toBe(2);
    expect(result.data.meritRatio).toBe(0.7);
    expect(result.data.randomRatio).toBe(0.3);
  });

  it("rejects meritRatio > 1", () => {
    const result = compareAllocationSchema.safeParse({ ...validBody, meritRatio: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects maxCoursesPerStudent of 0", () => {
    const result = compareAllocationSchema.safeParse({ ...validBody, maxCoursesPerStudent: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer maxCoursesPerStudent", () => {
    const result = compareAllocationSchema.safeParse({ ...validBody, maxCoursesPerStudent: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects missing semesterId", () => {
    const { semesterId: _omit, ...rest } = validBody;
    const result = compareAllocationSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects empty semesterId", () => {
    const result = compareAllocationSchema.safeParse({ ...validBody, semesterId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects when meritRatio + randomRatio != 1 (0.9 + 0.9 = 1.8)", () => {
    const result = compareAllocationSchema.safeParse({
      ...validBody,
      meritRatio: 0.9,
      randomRatio: 0.9,
    });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toMatch(/sum to exactly 1/i);
  });

  it("rejects when meritRatio + randomRatio != 1 (0.5 + 0.4 = 0.9)", () => {
    const result = compareAllocationSchema.safeParse({
      ...validBody,
      meritRatio: 0.5,
      randomRatio: 0.4,
    });
    expect(result.success).toBe(false);
  });

  it("accepts meritRatio=0 randomRatio=1", () => {
    const result = compareAllocationSchema.safeParse({
      semesterId: "SEM2026A",
      meritRatio: 0,
      randomRatio: 1,
    });
    expect(result.success).toBe(true);
  });

  it("accepts meritRatio=1 randomRatio=0", () => {
    const result = compareAllocationSchema.safeParse({
      semesterId: "SEM2026A",
      meritRatio: 1,
      randomRatio: 0,
    });
    expect(result.success).toBe(true);
  });
});

// ── Publish allocation schema ─────────────────────────────────────────────────
describe("publishAllocationSchema", () => {
  it("accepts 'optimized'", () => {
    const result = publishAllocationSchema.safeParse({ algorithm: "optimized" });
    expect(result.success).toBe(true);
    expect(result.data.algorithm).toBe("optimized");
  });

  it("accepts 'baseline'", () => {
    const result = publishAllocationSchema.safeParse({ algorithm: "baseline" });
    expect(result.success).toBe(true);
    expect(result.data.algorithm).toBe("baseline");
  });

  it("rejects missing algorithm", () => {
    const result = publishAllocationSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects invalid algorithm value", () => {
    const result = publishAllocationSchema.safeParse({ algorithm: "random" });
    expect(result.success).toBe(false);
  });

  it("rejects algorithm 'both'", () => {
    const result = publishAllocationSchema.safeParse({ algorithm: "both" });
    expect(result.success).toBe(false);
  });
});


