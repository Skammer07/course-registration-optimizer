import { describe, it, expect } from "vitest";

import { allocateOptimized } from "../src/algorithms/optimizedAllocation.js";
import { validateAllocation } from "../src/validation/validateAllocation.js";
import { runSingleAllocation } from "../src/services/singleAllocationService.js";
import { generateDataset } from "../../backend/src/seed/generateDataset.js";

function instance(scenario, size, seed) {
  const ds = generateDataset({ scenario, size, seed });
  const timetable = {};
  for (const c of ds.courses) timetable[c.courseCode] = c.timetableSlots;

  return {
    students: ds.students.map((s) => ({ id: s.studentId, cgpa: s.cgpa })),
    courses: ds.courses.map((c) => ({ id: c.courseCode, capacity: c.capacity })),
    preferences: ds.preferences.flatMap((p) =>
      p.courseCodes.map((code, i) => ({ studentId: p.studentId, courseId: code, rank: i + 1 }))
    ),
    timetable,
  };
}

const run = (data, extra = {}) =>
  allocateOptimized(
    { students: data.students, courses: data.courses, preferences: data.preferences },
    { maxCoursesPerStudent: 2, timetable: data.timetable, ...extra }
  );

describe("optimizer search limit", () => {
  // Needs many branches to prove optimality, so a small budget stops it early.
  const hard = instance("many-clashes", 60, 3);

  it("without a limit the search finishes and says the result is optimal", () => {
    const easy = instance("many-clashes", 40, 1);
    const result = run(easy);

    expect(result.assumptions.optimal).toBe(true);
    expect(result.assumptions.searchStopReason).toBeNull();
    expect(result.assumptions.searchBound).toBeNull();
  });

  it("stops at the limit with a valid, clash-free answer and an honest bound", () => {
    const result = run(hard, { maxFlowSolves: 30 });
    const { assumptions } = result;

    expect(assumptions.optimal).toBe(false);
    expect(assumptions.searchStopReason).toBe("solve-limit");
    expect(assumptions.flowSolves).toBeLessThanOrEqual(30 + 1);

    const check = validateAllocation({
      students: hard.students,
      courses: hard.courses,
      preferences: hard.preferences,
      allocations: result.allocations,
      timetable: hard.timetable,
      maxCoursesPerStudent: 2,
    });
    expect(check.valid).toBe(true);

    // the bound can never be worse than what was found
    expect(assumptions.searchBound.assignments).toBeGreaterThanOrEqual(result.totalAllocated);
    if (assumptions.searchBound.assignments === result.totalAllocated) {
      expect(assumptions.searchBound.preferenceCost).toBeLessThanOrEqual(result.totalPreferenceCost);
    }
  });

  it("is repeatable: the same limit gives the same answer", () => {
    const a = run(hard, { maxFlowSolves: 30 });
    const b = run(hard, { maxFlowSolves: 30 });
    expect(a.allocations).toEqual(b.allocations);
  });

  it("a limit that is never reached changes nothing", () => {
    const easy = instance("many-clashes", 40, 1);
    const exact = run(easy);
    const limited = run(easy, { maxFlowSolves: 100000 });

    expect(limited.assumptions.optimal).toBe(true);
    expect(limited.totalAllocated).toBe(exact.totalAllocated);
    expect(limited.totalPreferenceCost).toBe(exact.totalPreferenceCost);
  });

  it("a time limit of zero still returns a valid answer", () => {
    const result = run(hard, { searchTimeLimitMs: 0 });

    expect(result.assumptions.optimal).toBe(false);
    expect(result.assumptions.searchStopReason).toBe("time-limit");
    expect(
      validateAllocation({
        students: hard.students,
        courses: hard.courses,
        preferences: hard.preferences,
        allocations: result.allocations,
        timetable: hard.timetable,
        maxCoursesPerStudent: 2,
      }).valid
    ).toBe(true);
  });

  it("a work limit stops at the same point every time, whatever the machine does", () => {
    const a = run(hard, { maxWork: 30e6 });
    const b = run(hard, { maxWork: 30e6 });

    expect(a.assumptions.optimal).toBe(false);
    expect(a.assumptions.searchStopReason).toBe("work-limit");
    expect(a.assumptions.flowSolves).toBe(b.assumptions.flowSolves);
    expect(a.allocations).toEqual(b.allocations);
    expect(
      validateAllocation({
        students: hard.students, courses: hard.courses, preferences: hard.preferences,
        allocations: a.allocations, timetable: hard.timetable, maxCoursesPerStudent: 2,
      }).valid
    ).toBe(true);
  });

  it("the single-run service passes the limit through", () => {
    const result = runSingleAllocation(
      { students: hard.students, courses: hard.courses, preferences: hard.preferences, timetable: hard.timetable },
      { algorithm: "optimized", maxFlowSolves: 30 }
    );

    expect(result.assumptions.optimal).toBe(false);
    expect(result.validation.valid).toBe(true);
  });
});
