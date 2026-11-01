/**
 * tests/unit/singleRun.test.js
 * Running ONE selected algorithm per run, and comparing stored runs.
 * Models are an in-memory fake (several runs can coexist).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  runs: {},
  counter: 0,
  allocations: [],
  students: [],
  courses: [],
  preferences: [],
  calls: { deleteMany: 0 },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const clone = (v) => (v == null ? v : structuredClone(v));
const sid = (v) => String(v);
const hex = (n) => `507f1f77bcf86cd7994400${String(n).padStart(2, "0")}`;

function applyUpdate(run, update) {
  const set = update.$set ?? update;
  for (const [k, v] of Object.entries(set)) run[k] = clone(v);
}
const thenable = (value) => ({
  lean: () => Promise.resolve(clone(value)),
  then: (res, rej) => Promise.resolve(clone(value)).then(res, rej),
});

vi.mock("../../src/models/AllocationRun.js", () => ({
  default: {
    create: async (doc) => {
      const _id = hex(50 + ++db.counter);
      db.runs[_id] = { _id, ...clone(doc) };
      return clone(db.runs[_id]);
    },
    findById: (_id) => ({ lean: async () => clone(db.runs[sid(_id)] ?? null) }),
    findByIdAndUpdate: async (_id, update) => {
      applyUpdate(db.runs[sid(_id)], update);
      return clone(db.runs[sid(_id)]);
    },
    updateOne: async (filter, update) => {
      const r = db.runs[sid(filter._id)];
      if (r && (!filter.status || r.status === filter.status)) applyUpdate(r, update);
      return { matchedCount: 1 };
    },
    findOneAndUpdate: (filter, update) => {
      const r = db.runs[sid(filter._id)];
      const ok =
        r &&
        Object.entries(filter).every(([k, v]) => (k === "_id" ? true : r[k] === v));
      if (!ok) return thenable(null);
      applyUpdate(r, update);
      return thenable(r);
    },
  },
}));

vi.mock("../../src/models/Allocation.js", () => ({
  default: {
    insertMany: async (docs) => {
      docs.forEach((d, i) => db.allocations.push({ ...d, _id: `x${db.allocations.length + i}` }));
      return docs;
    },
    countDocuments: async (f) => db.allocations.filter((a) => sid(a.run) === sid(f.run)).length,
    deleteMany: async (f) => {
      db.calls.deleteMany++;
      db.allocations = db.allocations.filter((a) => sid(a.run) !== sid(f.run));
    },
    find: (f) => ({
      lean: async () =>
        clone(db.allocations.filter((a) => sid(a.run) === sid(f.run) && a.algorithm === f.algorithm)),
    }),
    updateMany: async (f, u) => {
      let n = 0;
      for (const a of db.allocations) {
        if (a.algorithm === f.algorithm && sid(a.run) === sid(f.run)) {
          a.status = u.$set.status;
          n++;
        }
      }
      return { matchedCount: n };
    },
  },
}));

// Semester: no record => preferences open (default behaviour)
vi.mock("../../src/models/Semester.js", () => ({
  default: {
    findOne: () => ({ lean: async () => null }),
    updateOne: async () => ({}),
  },
}));

vi.mock("../../src/models/Student.js", () => ({
  default: {
    find: (f) => ({
      lean: async () =>
        clone(f?._id ? db.students.filter((s) => f._id.$in.map(sid).includes(sid(s._id))) : db.students),
    }),
  },
}));
vi.mock("../../src/models/Course.js", () => ({
  default: {
    find: (f) => ({
      lean: async () =>
        clone(f?._id ? db.courses.filter((c) => f._id.$in.map(sid).includes(sid(c._id))) : db.courses),
    }),
  },
}));
vi.mock("../../src/models/Preference.js", () => ({
  default: {
    find: () => {
      const q = { populate: () => q, lean: async () => clone(db.preferences) };
      return q;
    },
  },
}));

import {
  executeAllocationComparison,
  executeSingleAllocation,
  compareRuns,
  publishAllocationRun,
} from "../../src/services/allocation.service.js";
import {
  _overrideComparisonService,
  _overrideSingleService,
} from "../../src/services/allocationEngine.service.js";

const ADMIN = "507f1f77bcf86cd799440002";

function seedLiveData() {
  db.students = [
    { _id: hex(10), studentId: "S1", name: "A", cgpa: 9, semesterId: "SEM1" },
    { _id: hex(11), studentId: "S2", name: "B", cgpa: 8, semesterId: "SEM1" },
    { _id: hex(12), studentId: "S3", name: "C", cgpa: 7, semesterId: "SEM1" },
  ];
  db.courses = [
    { _id: hex(20), courseCode: "C1", title: "C1", capacity: 2, semesterId: "SEM1", electiveGroup: "A",
      timetableSlots: [{ day: "Monday", start: "09:00", end: "10:00" }] },
    { _id: hex(21), courseCode: "C2", title: "C2", capacity: 2, semesterId: "SEM1", electiveGroup: "A",
      timetableSlots: [{ day: "Tuesday", start: "09:00", end: "10:00" }] },
  ];
  const c = (code) => ({ courseCode: code, electiveGroup: "A" });
  db.preferences = [
    { student: { studentId: "S1" }, electiveGroup: "A", rankedCourseIds: [c("C1"), c("C2")] },
    { student: { studentId: "S2" }, electiveGroup: "A", rankedCourseIds: [c("C1"), c("C2")] },
    { student: { studentId: "S3" }, electiveGroup: "A", rankedCourseIds: [c("C1")] },
  ];
  db.runs = {};
  db.counter = 0;
  db.allocations = [];
  db.calls = { deleteMany: 0 };
  _overrideComparisonService(null);
  _overrideSingleService(null);
}

const base = { semesterId: "SEM1", createdByUserId: ADMIN };
const algsIn = (runId) => [...new Set(db.allocations.filter((a) => sid(a.run) === sid(runId)).map((a) => a.algorithm))];

beforeEach(seedLiveData);

describe("executeSingleAllocation - each algorithm runs independently", () => {
  it("baseline-only run stores only baseline assignments, metrics and seed", async () => {
    const run = await executeSingleAllocation({ ...base, algorithm: "baseline", seed: 11 });
    expect(run.status).toBe("completed");
    expect(run.algorithmsRun).toEqual(["baseline"]);
    expect(algsIn(run._id)).toEqual(["baseline"]);
    expect(run.baselineMetrics.totalAssignments).toBe(
      db.allocations.filter((a) => a.algorithm === "baseline").length
    );
    expect(run.optimizedMetrics ?? null).toBeNull();
    expect(run.baselineValidation.valid).toBe(true);
    expect(run.randomSeed).toBe(11);
    expect(run.configuration.meritRatio).toBe(0.7);
    expect(run.configuration.oneCoursePerGroup).toBe(true);
    expect(run.inputFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(run.inputSnapshot.students).toHaveLength(3);
  });

  it("optimized-only run stores only optimized assignments, held to a baseline (split and seed are stored)", async () => {
    const run = await executeSingleAllocation({ ...base, algorithm: "optimized", seed: 7 });
    expect(run.status).toBe("completed");
    expect(run.algorithmsRun).toEqual(["optimized"]);
    expect(algsIn(run._id)).toEqual(["optimized"]);
    expect(run.optimizedMetrics.totalAssignments).toBeGreaterThan(0);
    expect(run.baselineMetrics ?? null).toBeNull();
    // the floor is the baseline's own result, so the run keeps the split and seed that produced it
    expect(run.configuration).toMatchObject({ optimizerFloor: "baseline", cgpaPriority: true, meritRatio: 0.7, randomRatio: 0.3 });
    expect(run.randomSeed).toBe(7);
  });

  it("without the floor an optimizer-only run has no split or seed", async () => {
    const run = await executeSingleAllocation({ ...base, algorithm: "optimized", optimizerFloor: "none", cgpaPriority: false });
    expect(run.status).toBe("completed");
    expect(run.configuration).toMatchObject({ optimizerFloor: "none", cgpaPriority: false, meritRatio: null, randomRatio: null });
    expect(run.randomSeed).toBeNull();
  });

  it("baseline accepts meritRatio 0 / randomRatio 1", async () => {
    const run = await executeSingleAllocation({
      ...base, algorithm: "baseline", meritRatio: 0, randomRatio: 1, seed: 1,
    });
    expect(run.status).toBe("completed");
    expect(run.configuration.meritRatio).toBe(0);
  });

  it("the same baseline seed reproduces the same assignments", async () => {
    const r1 = await executeSingleAllocation({ ...base, algorithm: "baseline", meritRatio: 0, randomRatio: 1, seed: 42 });
    const r2 = await executeSingleAllocation({ ...base, algorithm: "baseline", meritRatio: 0, randomRatio: 1, seed: 42 });
    const pairs = (id) =>
      db.allocations.filter((a) => sid(a.run) === sid(id)).map((a) => `${a.student}:${a.course}`).sort();
    expect(pairs(r1._id)).toEqual(pairs(r2._id));
  });

  it("failure inside the algorithm marks the run failed and leaves no assignments", async () => {
    _overrideSingleService({
      runSingleAllocation: () => {
        throw new Error("boom");
      },
    });
    await expect(executeSingleAllocation({ ...base, algorithm: "optimized" })).rejects.toMatchObject({
      code: "ALLOCATION_FAILED",
    });
    const [run] = Object.values(db.runs);
    expect(run.status).toBe("failed");
    expect(db.allocations).toHaveLength(0);
  });

  it("malformed output (unknown student) is rejected, cleaned up and the run is failed", async () => {
    _overrideSingleService({
      runSingleAllocation: () => ({
        configuration: { algorithmVersion: "t", randomSeed: null },
        allocations: [{ studentId: "NOPE", courseId: "C1", preferenceRank: 1 }],
        metrics: { totalAssignments: 1, constraintViolations: 0 },
        validation: { valid: true, errors: [] },
        runtimeMs: 1,
      }),
    });
    await expect(executeSingleAllocation({ ...base, algorithm: "optimized" })).rejects.toMatchObject({
      code: "PERSISTENCE_FAILED",
    });
    const [run] = Object.values(db.runs);
    expect(run.status).toBe("failed");
    expect(db.allocations).toHaveLength(0);
    expect(db.calls.deleteMany).toBe(1);
  });

  it("rejects an empty semester before creating a run", async () => {
    db.students = [];
    await expect(executeSingleAllocation({ ...base, algorithm: "baseline" })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(Object.keys(db.runs)).toHaveLength(0);
  });
});

describe("publishing a single-algorithm run", () => {
  it("publishes the algorithm it contains", async () => {
    const run = await executeSingleAllocation({ ...base, algorithm: "optimized" });
    const published = await publishAllocationRun(run._id, ADMIN, "optimized");
    expect(published.status).toBe("published");
    expect(published.selectedAlgorithm).toBe("optimized");
  });

  it("refuses an algorithm the run does not contain", async () => {
    const run = await executeSingleAllocation({ ...base, algorithm: "optimized" });
    await expect(publishAllocationRun(run._id, ADMIN, "baseline")).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(db.runs[run._id].status).toBe("completed");
  });
});

describe("compareRuns", () => {
  it("compares an independent baseline run with an independent optimized run (B minus A)", async () => {
    const a = await executeSingleAllocation({ ...base, algorithm: "baseline", seed: 3 });
    const b = await executeSingleAllocation({ ...base, algorithm: "optimized" });
    const cmp = await compareRuns({ runA: a._id, runB: b._id });
    expect(cmp.a.algorithm).toBe("baseline");
    expect(cmp.b.algorithm).toBe("optimized");
    expect(cmp.sameInput).toBe(true);
    expect(cmp.warnings).toEqual([]);
    expect(cmp.difference.totalAssignments).toBe(
      b.optimizedMetrics.totalAssignments - a.baselineMetrics.totalAssignments
    );
    expect(cmp).not.toHaveProperty("winner");
  });

  it("warns when the runs saw different input data", async () => {
    const a = await executeSingleAllocation({ ...base, algorithm: "baseline", seed: 3 });
    db.students[0].cgpa = 5; // data changed between the runs
    const b = await executeSingleAllocation({ ...base, algorithm: "optimized" });
    const cmp = await compareRuns({ runA: a._id, runB: b._id });
    expect(cmp.sameInput).toBe(false);
    expect(cmp.warnings.join(" ")).toMatch(/different input data/);
  });

  it("warns when maxCoursesPerStudent differs", async () => {
    const a = await executeSingleAllocation({ ...base, algorithm: "optimized", maxCoursesPerStudent: 1 });
    const b = await executeSingleAllocation({ ...base, algorithm: "optimized", maxCoursesPerStudent: 2 });
    const cmp = await compareRuns({ runA: a._id, runB: b._id });
    expect(cmp.warnings.join(" ")).toMatch(/maxCoursesPerStudent/);
  });

  it("a run holding both algorithms needs an explicit choice, and can be compared with itself", async () => {
    const both = await executeAllocationComparison({ ...base, seed: 2 });
    await expect(compareRuns({ runA: both._id, runB: both._id })).rejects.toMatchObject({ statusCode: 400 });
    const cmp = await compareRuns({
      runA: both._id, runB: both._id, algorithmA: "baseline", algorithmB: "optimized",
    });
    expect(cmp.sameInput).toBe(true);
    expect(cmp.a.algorithm).toBe("baseline");
    expect(cmp.b.algorithm).toBe("optimized");
  });

  it("rejects an algorithm the run does not contain", async () => {
    const a = await executeSingleAllocation({ ...base, algorithm: "baseline", seed: 1 });
    await expect(
      compareRuns({ runA: a._id, runB: a._id, algorithmA: "optimized" })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("404 for an unknown run, 400 for a failed run", async () => {
    const a = await executeSingleAllocation({ ...base, algorithm: "baseline", seed: 1 });
    await expect(compareRuns({ runA: a._id, runB: hex(99) })).rejects.toMatchObject({ statusCode: 404 });
    db.runs[a._id].status = "failed";
    await expect(compareRuns({ runA: a._id, runB: a._id })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("legacy runs without algorithmsRun are treated as holding both", async () => {
    const both = await executeAllocationComparison({ ...base, seed: 2 });
    delete db.runs[both._id].algorithmsRun;
    const cmp = await compareRuns({
      runA: both._id, runB: both._id, algorithmA: "baseline", algorithmB: "optimized",
    });
    expect(cmp.a.metrics).toBeDefined();
  });
});

describe("stale data, warnings and time limits at the service level", () => {
  it("a stale preference no longer fails the run; it is excluded and recorded on the run", async () => {
    db.preferences.push({
      student: { studentId: "GONE" }, electiveGroup: "A",
      rankedCourseIds: [{ courseCode: "C1", electiveGroup: "A" }],
    });
    db.preferences[0].rankedCourseIds.push({ courseCode: "WITHDRAWN", electiveGroup: "A" });

    const run = await executeSingleAllocation({ ...base, algorithm: "optimized" });
    expect(run.status).toBe("completed");
    expect(run.inputWarnings.skippedPreferences).toBe(1);
    expect(run.inputWarnings.droppedCourseEntries).toBe(1);
    expect(run.inputWarnings.messages.join(" ")).toMatch(/GONE/);
    // the snapshot holds only what the algorithm actually saw
    expect(run.inputSnapshot.preferences.every((p) => p.studentId !== "GONE")).toBe(true);

    const both = await executeAllocationComparison({ ...base, seed: 1 });
    expect(both.status).toBe("completed");
    expect(both.inputWarnings.skippedPreferences).toBe(1);
  });

  it("clean data records zero warnings", async () => {
    const run = await executeSingleAllocation({ ...base, algorithm: "baseline", seed: 1 });
    expect(run.inputWarnings).toMatchObject({ skippedPreferences: 0, droppedCourseEntries: 0, messages: [] });
  });

  describe("large timetable runs get an advisory (never a block)", () => {
    const addStudents = (total) => {
      for (let i = db.students.length; i < total; i++) {
        db.students.push({ _id: hex(1000 + i), studentId: `X${i}`, name: `X${i}`, cgpa: 6, semesterId: "SEM1" });
      }
    };
    const advisory = (run) => run.inputWarnings.messages.filter((m) => /timetable search can be/.test(m));

    it("warns for the optimizer and for a combined run, with the student count", async () => {
      addStudents(150);
      const opt = await executeSingleAllocation({ ...base, algorithm: "optimized" });
      expect(opt.status).toBe("completed");
      expect(advisory(opt)).toHaveLength(1);
      expect(advisory(opt)[0]).toMatch(/150 students/);

      const both = await executeAllocationComparison({ ...base, seed: 1 });
      expect(both.status).toBe("completed");
      expect(advisory(both)).toHaveLength(1);
    });

    it("does not warn for the baseline alone, with the timetable off, or for small runs", async () => {
      addStudents(150);
      expect(advisory(await executeSingleAllocation({ ...base, algorithm: "baseline", seed: 1 }))).toHaveLength(0);
      expect(advisory(await executeSingleAllocation({ ...base, algorithm: "optimized", includeTimetable: false }))).toHaveLength(0);
      seedLiveData();
      addStudents(149);
      expect(advisory(await executeSingleAllocation({ ...base, algorithm: "optimized" }))).toHaveLength(0);
    });
  });

  it("a worker that runs out of memory is a clear 500 ALLOCATION_OUT_OF_MEMORY and the run is failed", async () => {
    _overrideSingleService({
      runSingleAllocation: () => {
        throw Object.assign(new Error("heap"), { code: "ERR_WORKER_OUT_OF_MEMORY" });
      },
    });
    const err = await executeSingleAllocation({ ...base, algorithm: "optimized" }).catch((e) => e);
    expect(err).toMatchObject({ statusCode: 500, code: "ALLOCATION_OUT_OF_MEMORY" });
    expect(err.message).not.toMatch(/heap/);
    const [run] = Object.values(db.runs);
    expect(run.status).toBe("failed");
    expect(db.allocations).toHaveLength(0);
  });

  it("a partly filled-in timetable is a 400 before any run is created", async () => {
    db.courses[1].timetableSlots = [];
    await expect(executeSingleAllocation({ ...base, algorithm: "optimized" })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(Object.keys(db.runs)).toHaveLength(0);
    await expect(executeAllocationComparison({ ...base })).rejects.toMatchObject({ statusCode: 400 });
    expect(Object.keys(db.runs)).toHaveLength(0);
    // ... but it is fine when the timetable check is switched off
    const run = await executeSingleAllocation({ ...base, algorithm: "optimized", includeTimetable: false });
    expect(run.status).toBe("completed");
  });

  it("a timeout marks the run failed, leaves no assignments, and answers 504", async () => {
    const err = Object.assign(new Error("too slow"), { code: "ALLOCATION_TIMEOUT" });
    _overrideSingleService({
      runSingleAllocation: () => {
        throw err;
      },
    });
    await expect(executeSingleAllocation({ ...base, algorithm: "optimized" })).rejects.toMatchObject({
      statusCode: 504,
      code: "ALLOCATION_TIMEOUT",
    });
    const [run] = Object.values(db.runs);
    expect(run.status).toBe("failed");
    expect(db.allocations).toHaveLength(0);
  });
});
