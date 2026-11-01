/**
 * tests/unit/sharedPool.test.js
 * Open electives: one pool of courses, an independent priority list of up to 15
 * choices for each elective group (OE1, OE2, ...), and the group stored on every
 * assignment. No database is needed.
 */

import { describe, it, expect, vi } from "vitest";

// the logger loads the environment config, which needs a database URL that CI does not have
vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  MAX_PREFERENCES_PER_GROUP,
  requiredListLength,
  listLengthProblem,
  courseFitsGroup,
} from "../../src/utils/preferenceRules.js";
import { buildAllocationDocs } from "../../src/services/allocation.service.js";
import { validateStoredAssignments } from "../../src/services/publicationValidation.service.js";
import { normalizePreferences, runSingle, _overrideSingleService } from "../../src/services/allocationEngine.service.js";
import { runSingleAllocation } from "../../../algorithm/src/services/singleAllocationService.js";
import { validateAllocation } from "../../../algorithm/src/validation/validateAllocation.js";

describe("priority list length", () => {
  it("is at most 15", () => {
    expect(MAX_PREFERENCES_PER_GROUP).toBe(15);
    expect(listLengthProblem({ count: 16, status: "draft", poolSize: 30 })).toMatch(/at most 15/);
    expect(listLengthProblem({ count: 15, status: "draft", poolSize: 30 })).toBeNull();
  });

  it("a submitted list holds 15 choices when 15 or more courses exist", () => {
    expect(requiredListLength(25)).toBe(15);
    expect(listLengthProblem({ count: 15, status: "submitted", poolSize: 25 })).toBeNull();
    expect(listLengthProblem({ count: 14, status: "submitted", poolSize: 25 })).toMatch(/exactly 15/);
  });

  it("a submitted list holds every course when fewer than 15 exist", () => {
    expect(requiredListLength(6)).toBe(6);
    expect(listLengthProblem({ count: 6, status: "submitted", poolSize: 6 })).toBeNull();
    expect(listLengthProblem({ count: 5, status: "submitted", poolSize: 6 })).toMatch(/exactly 6 courses/);
  });

  it("a draft can be any length from the first choice up", () => {
    expect(listLengthProblem({ count: 1, status: "draft", poolSize: 25 })).toBeNull();
  });

  it("a course without a group fits every group; one with a group only its own", () => {
    expect(courseFitsGroup(null, "OE1")).toBe(true);
    expect(courseFitsGroup(undefined, "OE2")).toBe(true);
    expect(courseFitsGroup("OE1", "OE1")).toBe(true);
    expect(courseFitsGroup("OE1", "OE2")).toBe(false);
  });
});

describe("the group is kept on every assignment", () => {
  const studentMap = new Map([["S1", "student-oid"]]);
  const courseMap = new Map([["C1", "c1-oid"], ["C2", "c2-oid"]]);

  it("stores the group each course was given for", () => {
    const docs = buildAllocationDocs("run", "optimized", {
      allocations: [
        { studentId: "S1", courseId: "C1", preferenceRank: 2, phase: "optimized", electiveGroup: "OE1" },
        { studentId: "S1", courseId: "C2", preferenceRank: 1, phase: "optimized", electiveGroup: "OE2" },
      ],
    }, studentMap, courseMap);

    expect(docs.map((d) => d.electiveGroup)).toEqual(["OE1", "OE2"]);
  });

  it("keeps null for runs that had no groups", () => {
    const [doc] = buildAllocationDocs("run", "baseline", {
      allocations: [{ studentId: "S1", courseId: "C1", preferenceRank: 1, phase: "merit" }],
    }, studentMap, courseMap);
    expect(doc.electiveGroup).toBeNull();
  });
});

describe("publication check with one course in two groups' lists", () => {
  // C1 is rank 3 in OE1's list and rank 1 in OE2's list.
  const snapshot = {
    students: [{ id: "S1", cgpa: 9 }],
    courses: [{ id: "C1", capacity: 5, electiveGroup: null }, { id: "C2", capacity: 5, electiveGroup: null }],
    preferences: [
      { studentId: "S1", courseId: "C1", rank: 3, electiveGroup: "OE1" },
      { studentId: "S1", courseId: "C2", rank: 1, electiveGroup: "OE1" },
      { studentId: "S1", courseId: "C1", rank: 1, electiveGroup: "OE2" },
      { studentId: "S1", courseId: "C2", rank: 2, electiveGroup: "OE2" },
    ],
    timetable: null,
  };
  const run = {
    _id: "run1", semesterId: "SEM", inputSnapshot: snapshot, configuration: { maxCoursesPerStudent: 2, oneCoursePerGroup: true },
    optimizedMetrics: { totalAssignments: 2, constraintViolations: 0 }, optimizedValidation: { valid: true },
  };
  const studentsById = new Map([["s-oid", { studentId: "S1" }]]);
  const coursesById = new Map([["c1", { courseCode: "C1", semesterId: "SEM" }], ["c2", { courseCode: "C2", semesterId: "SEM" }]]);
  const stored = (c1Rank, c1Group, c2Rank, c2Group) => [
    { run: "run1", algorithm: "optimized", student: "s-oid", course: "c1", preferenceRank: c1Rank, electiveGroup: c1Group },
    { run: "run1", algorithm: "optimized", student: "s-oid", course: "c2", preferenceRank: c2Rank, electiveGroup: c2Group },
  ];
  const check = (allocations) =>
    validateStoredAssignments({ run, algorithm: "optimized", allocations, studentsById, coursesById, validateAllocation });

  it("compares each assignment with the list of its own group", () => {
    // C1 for OE2 (rank 1) and C2 for OE1 (rank 1): both match their own list
    expect(check(stored(1, "OE2", 1, "OE1")).valid).toBe(true);
  });

  it("flags a rank that belongs to the other group's list", () => {
    const result = check(stored(3, "OE2", 1, "OE1")); // C1 for OE2 is rank 1, not 3
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/stored rank 3 does not match the snapshot rank 1/);
  });

  it("flags two courses given for the same group", () => {
    const result = check(stored(3, "OE1", 1, "OE1"));
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/elective group "OE1"/);
  });
});

describe("a run through the real algorithm with one shared pool", () => {
  const slot = (day, start, end) => ({ day, start, end });
  const students = [
    { studentId: "S1", name: "A", cgpa: 9, department: "CSE" },
    { studentId: "S2", name: "B", cgpa: 8, department: "CSE" },
  ];
  const courses = [
    { courseCode: "O1", title: "One", capacity: 1, electiveGroup: null, timetableSlots: [slot("Monday", "09:00", "09:50")] },
    { courseCode: "O2", title: "Two", capacity: 2, electiveGroup: null, timetableSlots: [slot("Tuesday", "09:00", "09:50")] },
    { courseCode: "O3", title: "Three", capacity: 2, electiveGroup: null, timetableSlots: [slot("Wednesday", "09:00", "09:50")] },
  ];
  const list = (studentId, group, codes) => ({
    student: { studentId }, electiveGroup: group, rankedCourseIds: codes.map((courseCode) => ({ courseCode })),
  });
  const preferences = ["S1", "S2"].flatMap((id) => [list(id, "OE1", ["O1", "O2", "O3"]), list(id, "OE2", ["O1", "O2", "O3"])]);

  it("normalizePreferences keeps the list's group on every record", () => {
    const flat = normalizePreferences(preferences);
    expect(flat.filter((p) => p.electiveGroup === "OE1")).toHaveLength(6);
    expect(flat.filter((p) => p.electiveGroup === "OE2")).toHaveLength(6);
  });

  for (const algorithm of ["baseline", "optimized"]) {
    it(`${algorithm}: one course per group, never the same course twice, group stored`, async () => {
      _overrideSingleService({ runSingleAllocation });
      try {
        const { result } = await runSingle({ algorithm, students, courses, preferences, options: { seed: 1 } });

        expect(result.validation.valid).toBe(true);
        expect(result.metrics.groupLimitViolations).toBe(0);
        for (const id of ["S1", "S2"]) {
          const mine = result.allocations.filter((a) => a.studentId === id);
          expect(new Set(mine.map((a) => a.courseId)).size).toBe(mine.length);
          expect(new Set(mine.map((a) => a.electiveGroup)).size).toBe(mine.length);
          expect(mine.every((a) => ["OE1", "OE2"].includes(a.electiveGroup))).toBe(true);
        }
        // seats: 1 + 2 + 2 = 5 for 4 slots
        expect(result.allocations).toHaveLength(4);
      } finally {
        _overrideSingleService(null);
      }
    });
  }
});
