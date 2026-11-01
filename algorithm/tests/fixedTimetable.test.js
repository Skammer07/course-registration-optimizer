import { describe, it, expect } from "vitest";

import { clashesWithFixedSlots } from "../src/timetable/checkClash.js";
import { allocateOptimized } from "../src/algorithms/optimizedAllocation.js";
import { runAllocation } from "../src/algorithms/allocationPipeline.js";
import { validateAllocation } from "../src/validation/validateAllocation.js";
import { calculateMetrics } from "../src/evaluation/metrics.js";
import { runSingleAllocation } from "../src/services/singleAllocationService.js";
import { runAllocationComparison } from "../src/services/allocationComparisonService.js";

const timetable = {
  C1: [{ day: "Monday", start: "09:00", end: "09:50" }],
  C2: [{ day: "Tuesday", start: "09:00", end: "09:50" }],
  C3: [{ day: "Wednesday", start: "09:00", end: "09:50" }],
};

const students = [
  { id: "S1", cgpa: 9 },
  { id: "S2", cgpa: 8 },
];
const courses = [
  { id: "C1", capacity: 2 },
  { id: "C2", capacity: 2 },
  { id: "C3", capacity: 2 },
];
const preferences = [
  { studentId: "S1", courseId: "C1", rank: 1 },
  { studentId: "S1", courseId: "C2", rank: 2 },
  { studentId: "S2", courseId: "C1", rank: 1 },
  { studentId: "S2", courseId: "C3", rank: 2 },
];

// S1 has a compulsory class overlapping C1 on Monday.
const fixedTimetable = {
  S1: [{ day: "Monday", start: "09:30", end: "10:20" }],
};

const input = { students, courses, preferences };
const coursesOf = (allocations, id) =>
  allocations.filter((a) => a.studentId === id).map((a) => a.courseId).sort();

describe("clashesWithFixedSlots", () => {
  it("detects an overlap on the same day", () => {
    expect(clashesWithFixedSlots("C1", fixedTimetable.S1, timetable)).toBe(true);
  });

  it("does not treat back-to-back classes as a clash", () => {
    const fixed = [{ day: "Monday", start: "09:50", end: "10:40" }];
    expect(clashesWithFixedSlots("C1", fixed, timetable)).toBe(false);
  });

  it("ignores other days and students without fixed slots", () => {
    expect(clashesWithFixedSlots("C2", fixedTimetable.S1, timetable)).toBe(false);
    expect(clashesWithFixedSlots("C1", undefined, timetable)).toBe(false);
    expect(clashesWithFixedSlots("C1", [], timetable)).toBe(false);
  });
});

describe("optimizer with compulsory (fixed) slots", () => {
  it("never gives a course that overlaps a fixed slot, and counts removed preferences", () => {
    const result = allocateOptimized(input, {
      maxCoursesPerStudent: 2,
      timetable,
      fixedTimetable,
    });

    expect(coursesOf(result.allocations, "S1")).toEqual(["C2"]);
    expect(coursesOf(result.allocations, "S2")).toEqual(["C1", "C3"]);
    expect(result.assumptions.preferencesRemovedByFixedSlots).toBe(1);
    expect(result.assumptions.fixedTimetableEnabled).toBe(true);
  });

  it("leaves a student unallocated when every preference clashes", () => {
    const result = allocateOptimized(
      {
        students: [{ id: "S1", cgpa: 9 }],
        courses,
        preferences: [{ studentId: "S1", courseId: "C1", rank: 1 }],
      },
      { timetable, fixedTimetable }
    );

    expect(result.allocations).toHaveLength(0);
    expect(result.unallocatedStudentIds).toEqual(["S1"]);
  });

  it("gives the same result with no fixed slots, an empty map, or empty lists", () => {
    const options = { maxCoursesPerStudent: 2, timetable };
    const plain = allocateOptimized(input, options).allocations;

    expect(allocateOptimized(input, { ...options, fixedTimetable: {} }).allocations).toEqual(plain);
    expect(
      allocateOptimized(input, { ...options, fixedTimetable: { S1: [], S2: [] } }).allocations
    ).toEqual(plain);
  });

  it("ignores fixed slots when there is no timetable to compare against", () => {
    const result = allocateOptimized(input, { fixedTimetable });
    expect(result.assumptions.fixedTimetableEnabled).toBe(false);
  });
});

describe("baseline with compulsory (fixed) slots", () => {
  it("respects fixed slots in both the merit and random phases", () => {
    for (const meritRatio of [1, 0.5, 0]) {
      const result = runAllocation(input, {
        timetable,
        fixedTimetable,
        meritRatio,
        randomRatio: 1 - meritRatio,
        random: () => 0.5,
      });

      expect(coursesOf(result.allocations, "S1")).not.toContain("C1");
      expect(result.validation.valid).toBe(true);
    }
  });
});

describe("validator and metrics with fixed slots", () => {
  const bad = [{ studentId: "S1", courseId: "C1", preferenceRank: 1 }];

  it("rejects an allocation that overlaps a compulsory slot", () => {
    const result = validateAllocation({
      ...input,
      allocations: bad,
      timetable,
      fixedTimetable,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/compulsory/);
  });

  it("accepts the same allocation when the student has no fixed slots", () => {
    expect(
      validateAllocation({ ...input, allocations: bad, timetable }).valid
    ).toBe(true);
  });

  it("counts the overlap as a timetable clash and constraint violation", () => {
    const metrics = calculateMetrics({
      ...input,
      allocations: bad,
      timetable,
      fixedTimetable,
    });

    expect(metrics.timetableClashes).toBe(1);
    expect(metrics.constraintViolations).toBe(1);
  });
});

describe("services pass fixed slots through", () => {
  it("single run and comparison both produce valid, clash-free results", () => {
    const full = { ...input, timetable, fixedTimetable };

    for (const algorithm of ["baseline", "optimized"]) {
      const r = runSingleAllocation(full, { algorithm, seed: 1 });
      expect(coursesOf(r.allocations, "S1")).not.toContain("C1");
      expect(r.configuration.fixedTimetableEnabled).toBe(true);
      expect(r.metrics.timetableClashes).toBe(0);
    }

    const both = runAllocationComparison(full, { seed: 1 });
    expect(coursesOf(both.baseline.allocations, "S1")).not.toContain("C1");
    expect(coursesOf(both.optimized.allocations, "S1")).not.toContain("C1");
    expect(both.baseline.metrics.timetableClashes).toBe(0);
  });
});
