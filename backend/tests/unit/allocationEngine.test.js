/**
 * tests/unit/allocationEngine.test.js
 * Unit tests for the allocation engine service normalization functions.
 * Does NOT require a database or live algorithm execution.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  normalizeStudents,
  normalizeCourses,
  buildTimetableMap,
  normalizePreferences,
  _overrideComparisonService,
} from "../../src/services/allocationEngine.service.js";
import { algStudents, algCourses, algPreferences, sampleStudents, sampleCourses } from "../fixtures/sampleData.js";

// ── normalizeStudents ────────────────────────────────────────────────────────
describe("normalizeStudents", () => {
  it("maps studentId → id, name, cgpa", () => {
    const result = normalizeStudents(sampleStudents);
    expect(result).toEqual(algStudents);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeStudents([])).toEqual([]);
  });
});

// ── normalizeCourses ─────────────────────────────────────────────────────────
describe("normalizeCourses", () => {
  it("maps courseCode → id, title → name, capacity", () => {
    const result = normalizeCourses(sampleCourses);
    // electiveGroup is now carried through (group identity is not dropped).
    expect(result).toEqual(
      algCourses.map((c, i) => ({ ...c, electiveGroup: sampleCourses[i].electiveGroup ?? null }))
    );
  });

  it("returns empty array for empty input", () => {
    expect(normalizeCourses([])).toEqual([]);
  });
});

// ── buildTimetableMap ────────────────────────────────────────────────────────
describe("buildTimetableMap", () => {
  it("builds a timetable map keyed by courseCode", () => {
    const result = buildTimetableMap(sampleCourses);
    expect(result).toBeTruthy();
    expect(result["CS301"]).toEqual([{ day: "Monday", start: "09:00", end: "09:50" }]);
  });

  it("returns null when no courses have timetable slots", () => {
    const courses = sampleCourses.map(c => ({ ...c, timetableSlots: [] }));
    expect(buildTimetableMap(courses)).toBeNull();
  });
});

// ── normalizePreferences ─────────────────────────────────────────────────────
describe("normalizePreferences", () => {
  it("converts grouped preferences to flat { studentId, courseId, rank } records", () => {
    // Simulate populated Preference documents
    const mockPreferences = [
      {
        student: { studentId: "S001" },
        rankedCourseIds: [
          { courseCode: "CS301" },
          { courseCode: "CS302" },
        ],
      },
      {
        student: { studentId: "S002" },
        rankedCourseIds: [
          { courseCode: "CS301" },
          { courseCode: "CS303" },
        ],
      },
    ];

    const result = normalizePreferences(mockPreferences);

    expect(result).toEqual([
      { studentId: "S001", courseId: "CS301", rank: 1, electiveGroup: null },
      { studentId: "S001", courseId: "CS302", rank: 2, electiveGroup: null },
      { studentId: "S002", courseId: "CS301", rank: 1, electiveGroup: null },
      { studentId: "S002", courseId: "CS303", rank: 2, electiveGroup: null },
    ]);
  });

  it("skips entries with missing studentId", () => {
    const mockPreferences = [
      { student: null, rankedCourseIds: [{ courseCode: "CS301" }] },
    ];
    const result = normalizePreferences(mockPreferences);
    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(normalizePreferences([])).toEqual([]);
  });
});

// ── runComparison (with mock) ────────────────────────────────────────────────
describe("runComparison with mocked algorithm", () => {
  beforeEach(() => {
    // Reset to null so each test starts fresh
    _overrideComparisonService(null);
  });

  it("invokes runAllocationComparison with normalized input", async () => {
    const mockResult = {
      success: true,
      configuration: { maxCoursesPerStudent: 2, meritRatio: 0.75, randomRatio: 0.25 },
      baseline: {
        allocations: [{ studentId: "S001", courseId: "CS301", preferenceRank: 1, phase: "merit" }],
        metrics: { totalAssignments: 1, constraintViolations: 0, averagePreferenceRank: 1 },
        runtimeMs: 5,
        validation: { valid: true, errors: [] },
        phaseSummary: { merit: { allocated: 1 }, random: { allocated: 0 } },
      },
      optimized: {
        allocations: [{ studentId: "S001", courseId: "CS301", preferenceRank: 1, phase: "optimized" }],
        metrics: { totalAssignments: 1, constraintViolations: 0, averagePreferenceRank: 1 },
        runtimeMs: 8,
        validation: { valid: true, errors: [] },
        totalAllocated: 1,
        totalPreferenceCost: 0,
        studentSummary: [],
        courseSummary: [],
        assumptions: {},
      },
      comparison: {
        improvement: {},
        validComparison: true,
        note: "test note",
      },
    };

    const mockFn = vi.fn().mockReturnValue(mockResult);
    _overrideComparisonService({ runAllocationComparison: mockFn });

    const { runComparison } = await import("../../src/services/allocationEngine.service.js");

    const { result } = await runComparison({
      students: sampleStudents,
      courses: sampleCourses,
      preferences: [
        {
          student: { studentId: "S001" },
          rankedCourseIds: [{ courseCode: "CS301" }],
        },
      ],
      includeTimetable: false,
      options: { maxCoursesPerStudent: 2, meritRatio: 0.75, randomRatio: 0.25 },
    });

    expect(mockFn).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.baseline.allocations).toHaveLength(1);
  });
});

