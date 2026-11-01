/**
 * tests/unit/seedDataset.test.js
 * The mock-data generator: determinism, scenario characteristics, model
 * validity, and that every scenario runs cleanly through both real algorithms.
 */

import { describe, it, expect } from "vitest";
import { generateDataset, SCENARIOS, OPEN_ELECTIVES, OPEN_GROUPS, SIZES, GROUPS, seedEmail } from "../../src/seed/generateDataset.js";
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
        // the unconstrained optimizer, whose search is the long one
        runSingle({ ...docs, algorithm: "optimized", includeTimetable: true, options: { optimizerFloor: "none", cgpaPriority: false } })
      ).rejects.toMatchObject({ code: "ALLOCATION_TIMEOUT" });
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      if (prev === undefined) delete process.env.ALLOCATION_TIMEOUT_MS;
      else process.env.ALLOCATION_TIMEOUT_MS = prev;
    }
  }, 30_000);
});

describe("generateDataset - open electives (one shared pool, two independent 15-choice lists)", () => {
  const make = (size = 200, seed = 1) => generateDataset({ scenario: OPEN_ELECTIVES, size, seed });

  it("is deterministic and keeps the regular scenarios separate", () => {
    expect(make(60, 3)).toEqual(make(60, 3));
    expect(make(60, 3)).not.toEqual(make(60, 4));
    expect(SCENARIOS).not.toContain(OPEN_ELECTIVES);
  });

  it("makes a pool of courses with no group, and students in OE1 and OE2", () => {
    const ds = make();
    expect(ds.courses).toHaveLength(25);
    expect(ds.courses.every((c) => c.electiveGroup === null && /^SD-P\d{2}$/.test(c.courseCode))).toBe(true);
    expect(ds.students.every((s) => s.electiveGroups.join() === OPEN_GROUPS.join())).toBe(true);
    // seats cover the 2 x 200 slots to fill, with some room
    expect(ds.courses.reduce((n, c) => n + c.capacity, 0)).toBeGreaterThan(400);
  });

  it("gives every student two lists of exactly 15 different courses, one per group, all from the pool", () => {
    const ds = make();
    const codes = new Set(ds.courses.map((c) => c.courseCode));
    expect(ds.preferences).toHaveLength(200 * 2);
    for (const p of ds.preferences) {
      expect(OPEN_GROUPS).toContain(p.electiveGroup);
      expect(p.courseCodes).toHaveLength(15);
      expect(new Set(p.courseCodes).size).toBe(15);
      expect(p.courseCodes.every((c) => codes.has(c))).toBe(true);
      expect(p.status).toBe("submitted");
    }
  });

  it("the number of courses can be set, and lists are 15 long when the pool allows it", () => {
    const ds = generateDataset({ scenario: OPEN_ELECTIVES, size: 100, seed: 1, courseCount: 20 });
    expect(ds.courses).toHaveLength(20);
    expect(ds.preferences.every((p) => p.courseCodes.length === 15)).toBe(true);
    // about 1.2 x the 200 slots, spread over 20 courses
    expect(ds.courses.reduce((n, c) => n + c.capacity, 0)).toBeGreaterThan(200);
    expect(() => generateDataset({ scenario: OPEN_ELECTIVES, size: 100, courseCount: 0 })).toThrow(/courseCount/);
    // a short pool gives shorter lists
    expect(generateDataset({ scenario: OPEN_ELECTIVES, size: 20, courseCount: 6 }).preferences.every((p) => p.courseCodes.length === 6)).toBe(true);
  });

  it("the two lists of a student are drawn independently, so they differ but overlap", () => {
    const ds = make();
    let differ = 0, overlap = 0;
    for (const s of ds.students) {
      const [a, b] = OPEN_GROUPS.map((g) => ds.preferences.find((p) => p.studentId === s.studentId && p.electiveGroup === g).courseCodes);
      if (a.join() !== b.join()) differ++;
      if (a.some((c) => b.includes(c))) overlap++;
    }
    expect(differ).toBeGreaterThan(150);
    expect(overlap).toBe(200); // 15 of 25 each: they always share courses
  });

  it("every document passes the real Mongoose validation", () => {
    const ds = make(30, 2);
    for (const st of ds.students) expect(new Student(st).validateSync()).toBeUndefined();
    for (const c of ds.courses) expect(new Course(c).validateSync()).toBeUndefined();
  });

  it("runs cleanly through both real algorithms: valid, one course per group, never the same course twice", async () => {
    const ds = make(40, 5);
    const docs = asDocs(ds);
    const prepared = prepareInputs({ students: docs.students, courses: docs.courses, preferences: docs.preferences, includeTimetable: true });

    const { result } = await runComparison({
      students: docs.students, courses: docs.courses, preferences: prepared.preferences, includeTimetable: true, options: { seed: 1 },
    });

    for (const side of [result.baseline, result.optimized]) {
      expect(side.validation.valid).toBe(true);
      expect(side.metrics.groupLimitViolations).toBe(0);
      expect(side.metrics.duplicateAssignments).toBe(0);
      expect(side.metrics.timetableClashes).toBe(0);
      for (const st of ds.students) {
        const mine = side.allocations.filter((a) => a.studentId === st.studentId);
        expect(new Set(mine.map((a) => a.courseId)).size).toBe(mine.length);
        expect(new Set(mine.map((a) => a.electiveGroup)).size).toBe(mine.length);
      }
    }
  }, 60000);
});
