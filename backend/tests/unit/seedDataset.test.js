/**
 * tests/unit/seedDataset.test.js
 * The mock-data generator: determinism, scenario characteristics, model
 * validity, and that every scenario runs cleanly through both real algorithms.
 */

import { describe, it, expect } from "vitest";
import { generateDataset, SCENARIOS, SIZES, GROUPS, seedEmail } from "../../src/seed/generateDataset.js";
import Student from "../../src/models/Student.js";
import Course from "../../src/models/Course.js";
import Preference from "../../src/models/Preference.js";
import { prepareInputs, runComparison, runSingle } from "../../src/services/allocationEngine.service.js";

/** Convert generated plain data into the shape the service layer loads from MongoDB. */
function asDocs(ds) {
  const byCode = new Map(ds.courses.map((c) => [c.courseCode, c]));
  const studentByCode = new Map(ds.students.map((s) => [s.studentId, s]));
  return {
    students: ds.students,
    courses: ds.courses,
    preferences: ds.preferences.map((p) => ({
      student: { studentId: p.studentId, cgpa: studentByCode.get(p.studentId).cgpa },
      electiveGroup: p.electiveGroup,
      rankedCourseIds: p.courseCodes.map((code) => ({
        courseCode: code,
        electiveGroup: byCode.get(code).electiveGroup,
      })),
    })),
  };
}

describe("generateDataset - determinism and shape", () => {
  it("same options give identical data; a different seed gives different data", () => {
    const a = generateDataset({ scenario: "balanced", size: 30, seed: 7 });
    const b = generateDataset({ scenario: "balanced", size: 30, seed: 7 });
    const c = generateDataset({ scenario: "balanced", size: 30, seed: 8 });
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("creates SEED/SD- identifiers, groups A and B, and one list per student per group", () => {
    const ds = generateDataset({ size: 30 });
    expect(ds.students).toHaveLength(30);
    expect(ds.students.every((s) => /^SEED\d{4}$/.test(s.studentId))).toBe(true);
    expect(ds.courses.every((c) => /^SD-[AB]\d+$/.test(c.courseCode))).toBe(true);
    expect(ds.preferences).toHaveLength(30 * GROUPS.length);
    expect(seedEmail("SEED0001")).toBe("seed0001@seed.local");
  });

  it("preferences only reference courses of the same group, without duplicates, within 15", () => {
    const ds = generateDataset({ size: 200, seed: 3 });
    const group = new Map(ds.courses.map((c) => [c.courseCode, c.electiveGroup]));
    for (const p of ds.preferences) {
      expect(p.courseCodes.length).toBeGreaterThan(0);
      expect(p.courseCodes.length).toBeLessThanOrEqual(15);
      expect(new Set(p.courseCodes).size).toBe(p.courseCodes.length);
      expect(p.courseCodes.every((code) => group.get(code) === p.electiveGroup)).toBe(true);
    }
  });

  it.each([
    [{ scenario: "nope" }],
    [{ size: 2 }],
    [{ size: 1.5 }],
    [{ size: 100000 }],
    [{ semesterId: "  " }],
  ])("rejects invalid options %j", (opts) => {
    expect(() => generateDataset(opts)).toThrow();
  });

  it("exposes the named sizes", () => {
    expect(SIZES).toEqual({ small: 30, medium: 200, large: 1000 });
  });
});

describe("generateDataset - every document passes the real Mongoose validation", () => {
  it.each(SCENARIOS)("%s", (scenario) => {
    const ds = generateDataset({ scenario, size: 30, seed: 2 });
    for (const s of ds.students) expect(new Student(s).validateSync()).toBeUndefined();
    for (const c of ds.courses) expect(new Course(c).validateSync()).toBeUndefined();
    const sample = ds.preferences[0];
    const oid = "507f1f77bcf86cd799440001";
    expect(
      new Preference({
        student: oid, semesterId: sample.semesterId, electiveGroup: sample.electiveGroup,
        rankedCourseIds: sample.courseCodes.map(() => undefined).map((_, i) => `507f1f77bcf86cd7994400${String(10 + i).padStart(2, "0")}`),
        status: "submitted",
      }).validateSync()
    ).toBeUndefined();
  });
});

describe("scenario characteristics", () => {
  const seatsPerStudent = (ds) => {
    const total = ds.courses.reduce((n, c) => n + c.capacity, 0);
    return total / (ds.students.length * GROUPS.length);
  };

  it("scarce-seats has clearly fewer seats than balanced", () => {
    const balanced = generateDataset({ scenario: "balanced", size: 200, seed: 1 });
    const scarce = generateDataset({ scenario: "scarce-seats", size: 200, seed: 1 });
    expect(seatsPerStudent(scarce)).toBeLessThan(seatsPerStudent(balanced) * 0.7);
    expect(seatsPerStudent(scarce)).toBeLessThan(1);
    expect(seatsPerStudent(balanced)).toBeGreaterThan(1);
  });

  it("many-ties uses only four distinct CGPA values", () => {
    const ds = generateDataset({ scenario: "many-ties", size: 200, seed: 1 });
    expect(new Set(ds.students.map((s) => s.cgpa)).size).toBeLessThanOrEqual(4);
    const normal = generateDataset({ scenario: "balanced", size: 200, seed: 1 });
    expect(new Set(normal.students.map((s) => s.cgpa)).size).toBeGreaterThan(20);
  });

  it("many-clashes draws every slot from a small pool of twelve", () => {
    const ds = generateDataset({ scenario: "many-clashes", size: 200, seed: 1 });
    const distinct = new Set(ds.courses.flatMap((c) => c.timetableSlots.map((s) => `${s.day}${s.start}`)));
    expect(distinct.size).toBeLessThanOrEqual(12);
    const normal = generateDataset({ scenario: "balanced", size: 200, seed: 1 });
    expect(new Set(normal.courses.flatMap((c) => c.timetableSlots.map((s) => `${s.day}${s.start}`))).size).toBeGreaterThan(12);
  });
});

describe("every scenario runs through the real algorithms (in a worker thread)", () => {
  // The optimizer's timetable conflict search is impractically slow on larger
  // clash-heavy data (see README), so the timetable is exercised at "small"
  // and the "medium" runs disable it.
  for (const scenario of SCENARIOS) {
    for (const [size, includeTimetable] of [["small", true], ["medium", false]]) {
      it(`${scenario} / ${size}${includeTimetable ? "" : " (no timetable)"}: both algorithms produce valid allocations`, async () => {
        const docs = asDocs(generateDataset({ scenario, size: SIZES[size], seed: 5 }));
        const prepared = prepareInputs({ ...docs, includeTimetable });
        expect(prepared.warnings.skippedPreferences).toBe(0);

        const both = await runComparison({
          ...docs, preferences: prepared.preferences, includeTimetable, options: { seed: 5 },
        });
        expect(both.result.baseline.validation.valid).toBe(true);
        expect(both.result.optimized.validation.valid).toBe(true);
        expect(both.result.baseline.metrics.constraintViolations).toBe(0);
        expect(both.result.optimized.metrics.constraintViolations).toBe(0);
        expect(both.result.optimized.metrics.totalAssignments).toBeGreaterThan(0);

        // an independent single run gives the same answer as the combined run
        const single = await runSingle({
          ...docs, preferences: prepared.preferences, includeTimetable, algorithm: "baseline", options: { seed: 5 },
        });
        expect(single.result.allocations).toEqual(both.result.baseline.allocations);
      }, 60_000);
    }
  }

  it("scarce-seats leaves more students unallocated than balanced (the scenarios really differ)", async () => {
    const run = async (scenario) => {
      const docs = asDocs(generateDataset({ scenario, size: 200, seed: 5 }));
      const { result } = await runSingle({ ...docs, algorithm: "optimized", includeTimetable: false, options: {} });
      return result.metrics;
    };
    const scarce = await run("scarce-seats");
    const balanced = await run("balanced");
    expect(scarce.unallocatedStudents).toBeGreaterThan(balanced.unallocatedStudents);
    expect(scarce.capacityUtilization).toBeGreaterThan(balanced.capacityUtilization);
  }, 60_000);

  it("a run that exceeds the time limit is stopped with ALLOCATION_TIMEOUT instead of hanging", async () => {
    // balanced / medium with the timetable enabled does not finish in 40+ seconds
    const docs = asDocs(generateDataset({ scenario: "balanced", size: 200, seed: 5 }));
    const prev = process.env.ALLOCATION_TIMEOUT_MS;
    process.env.ALLOCATION_TIMEOUT_MS = "800";
    const started = Date.now();
    try {
      await expect(
        runSingle({ ...docs, algorithm: "optimized", includeTimetable: true, options: {} })
      ).rejects.toMatchObject({ code: "ALLOCATION_TIMEOUT" });
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      if (prev === undefined) delete process.env.ALLOCATION_TIMEOUT_MS;
      else process.env.ALLOCATION_TIMEOUT_MS = prev;
    }
  }, 30_000);
});
