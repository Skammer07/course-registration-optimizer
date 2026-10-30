/**
 * tests/unit/allocationLifecycle.test.js
 * Allocation persistence, snapshot, pre-publication validation and
 * publication-concurrency tests.
 *
 * The Mongoose models are replaced with a small in-memory fake. Its
 * findOneAndUpdate / updateOne apply the conditional update synchronously in
 * one tick, mirroring MongoDB's per-document atomicity; so the concurrency
 * tests verify OUR state machine given that primitive. They do not prove
 * MongoDB's atomicity (see README: replica-set / real-DB verification).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  run: null,
  allocations: [],
  students: [],
  courses: [],
  preferences: [],
  hooks: {},
  calls: { deleteMany: 0, insertMany: 0, updateMany: [] },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const clone = (v) => (v == null ? v : structuredClone(v));
const sid = (v) => String(v);

function applyUpdate(update) {
  const set = update.$set ?? update;
  for (const [k, v] of Object.entries(set)) db.run[k] = clone(v);
}
function matches(filter) {
  if (!db.run) return false;
  return Object.entries(filter).every(([k, v]) =>
    k === "_id"
      ? sid(db.run._id) === sid(v)
      : db.run[k] instanceof Date || v instanceof Date
        ? +new Date(db.run[k]) === +new Date(v)
        : db.run[k] === v
  );
}
const thenable = (value) => ({
  lean: () => Promise.resolve(clone(value)),
  then: (res, rej) => Promise.resolve(clone(value)).then(res, rej),
});

vi.mock("../../src/models/AllocationRun.js", () => ({
  default: {
    create: async (doc) => {
      db.run = { _id: "507f1f77bcf86cd799440001", ...clone(doc) };
      return clone(db.run);
    },
    findById: () => ({ lean: async () => clone(db.run) }),
    findByIdAndUpdate: async (_id, update) => {
      applyUpdate(update);
      return clone(db.run);
    },
    updateOne: async (filter, update) => {
      if (matches(filter)) applyUpdate(update);
      return { matchedCount: 1 };
    },
    findOneAndUpdate: (filter, update) => {
      if (!matches(filter)) return thenable(null);
      applyUpdate(update);
      return thenable(db.run);
    },
  },
}));

vi.mock("../../src/models/Allocation.js", () => ({
  default: {
    insertMany: async (docs) => {
      db.calls.insertMany++;
      if (db.hooks.insertPartial) {
        db.allocations.push({ ...docs[0], _id: "x0" });
        throw new Error("simulated write failure");
      }
      docs.forEach((d, i) => db.allocations.push({ ...d, _id: `x${i}` }));
      return docs;
    },
    countDocuments: async () => db.allocations.length - (db.hooks.countShort ?? 0),
    deleteMany: async () => {
      db.calls.deleteMany++;
      db.allocations = [];
    },
    find: (filter) => ({
      lean: async () =>
        clone(
          db.allocations.filter(
            (a) => sid(a.run) === sid(filter.run) && a.algorithm === filter.algorithm
          )
        ),
    }),
    updateMany: async (filter, update) => {
      db.calls.updateMany.push({ algorithm: filter.algorithm, status: update.$set.status });
      if (db.hooks.updateManyFails && update.$set.status === "published") {
        throw new Error("simulated update failure");
      }
      let n = 0;
      for (const a of db.allocations) {
        if (a.algorithm === filter.algorithm && sid(a.run) === sid(filter.run)) {
          a.status = update.$set.status;
          n++;
        }
      }
      return { matchedCount: n - (db.hooks.matchedShort && update.$set.status === "published" ? 1 : 0) };
    },
  },
}));

vi.mock("../../src/models/Student.js", () => ({
  default: {
    find: (filter) => ({
      lean: async () =>
        clone(filter?._id ? db.students.filter((s) => filter._id.$in.map(sid).includes(sid(s._id))) : db.students),
    }),
  },
}));
vi.mock("../../src/models/Course.js", () => ({
  default: {
    find: (filter) => ({
      lean: async () =>
        clone(filter?._id ? db.courses.filter((c) => filter._id.$in.map(sid).includes(sid(c._id))) : db.courses),
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
  publishAllocationRun,
  buildAllocationDocs,
} from "../../src/services/allocation.service.js";
import { _overrideComparisonService } from "../../src/services/allocationEngine.service.js";

const RUN_ID = "507f1f77bcf86cd799440001";
const ADMIN = "507f1f77bcf86cd799440002";
const id = (n) => `507f1f77bcf86cd7994400${String(n).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function seedLiveData() {
  db.students = [
    { _id: id(10), studentId: "S1", name: "A", cgpa: 9, semesterId: "SEM1" },
    { _id: id(11), studentId: "S2", name: "B", cgpa: 8, semesterId: "SEM1" },
  ];
  db.courses = [
    { _id: id(20), courseCode: "C1", title: "C1", capacity: 1, semesterId: "SEM1", electiveGroup: "A",
      timetableSlots: [{ day: "Monday", start: "09:00", end: "10:00" }] },
    { _id: id(21), courseCode: "C2", title: "C2", capacity: 2, semesterId: "SEM1", electiveGroup: "A",
      timetableSlots: [{ day: "Monday", start: "09:30", end: "10:30" }] },
    { _id: id(22), courseCode: "C3", title: "C3", capacity: 1, semesterId: "SEM1", electiveGroup: "B",
      timetableSlots: [{ day: "Tuesday", start: "09:00", end: "10:00" }] },
  ];
  const c = (code, g) => ({ courseCode: code, electiveGroup: g });
  db.preferences = [
    { student: { studentId: "S1" }, electiveGroup: "A", rankedCourseIds: [c("C1", "A"), c("C2", "A")] },
    { student: { studentId: "S2" }, electiveGroup: "A", rankedCourseIds: [c("C1", "A")] },
    { student: { studentId: "S2" }, electiveGroup: "B", rankedCourseIds: [c("C3", "B")] },
  ];
  db.allocations = [];
  db.run = null;
  db.hooks = {};
  db.calls = { deleteMany: 0, insertMany: 0, updateMany: [] };
}

const metrics = (n) => ({ totalAssignments: n, constraintViolations: 0 });
const alloc = (algorithm, student, course, rank, extra = {}) => ({
  run: RUN_ID, algorithm, student: id(student), course: id(course),
  preferenceRank: rank, status: "proposed", ...extra,
});

/** A completed run whose snapshot + stored assignments are internally valid. */
function seedCompletedRun() {
  seedLiveData();
  db.run = {
    _id: RUN_ID,
    semesterId: "SEM1",
    status: "completed",
    configuration: { maxCoursesPerStudent: 2, meritRatio: 0.75, randomRatio: 0.25 },
    baselineMetrics: metrics(2),
    optimizedMetrics: metrics(2),
    baselineValidation: { valid: true, errorCount: 0, errorList: [] },
    optimizedValidation: { valid: true, errorCount: 0, errorList: [] },
    selectedAlgorithm: null,
    inputSnapshot: {
      students: [{ id: "S1", name: "A", cgpa: 9 }, { id: "S2", name: "B", cgpa: 8 }],
      courses: [
        { id: "C1", name: "C1", capacity: 1, electiveGroup: "A" },
        { id: "C2", name: "C2", capacity: 2, electiveGroup: "A" },
        { id: "C3", name: "C3", capacity: 1, electiveGroup: "B" },
      ],
      preferences: [
        { studentId: "S1", courseId: "C1", rank: 1, electiveGroup: "A" },
        { studentId: "S1", courseId: "C2", rank: 2, electiveGroup: "A" },
        { studentId: "S2", courseId: "C1", rank: 1, electiveGroup: "A" },
        { studentId: "S2", courseId: "C3", rank: 1, electiveGroup: "B" },
      ],
      timetable: {
        C1: [{ day: "Monday", start: "09:00", end: "10:00" }],
        C2: [{ day: "Monday", start: "09:30", end: "10:30" }],
        C3: [{ day: "Tuesday", start: "09:00", end: "10:00" }],
      },
    },
  };
  db.allocations = [
    alloc("optimized", 10, 20, 1), alloc("optimized", 11, 22, 1),
    alloc("baseline", 10, 21, 2), alloc("baseline", 11, 20, 1),
  ];
}

const publish = (algorithm) => publishAllocationRun(RUN_ID, ADMIN, algorithm);
const statusesOf = (algorithm) => db.allocations.filter((a) => a.algorithm === algorithm).map((a) => a.status);

// ---------------------------------------------------------------------------
// Phase 5/10: persistence of runs
// ---------------------------------------------------------------------------
describe("executeAllocationComparison - persistence and consistency", () => {
  const params = { semesterId: "SEM1", createdByUserId: ADMIN, seed: 5 };

  const fakeResult = (over = {}) => ({
    configuration: { algorithmVersion: "t", randomSeed: 5 },
    baseline: {
      allocations: [{ studentId: "S1", courseId: "C1", preferenceRank: 1, phase: "merit" }],
      metrics: metrics(1),
      validation: { valid: true, errors: [] },
      runtimeMs: 1,
    },
    optimized: {
      allocations: [{ studentId: "S2", courseId: "C3", preferenceRank: 1 }],
      metrics: metrics(1),
      validation: { valid: true, errors: [] },
      runtimeMs: 1,
    },
    comparison: { improvement: {}, validComparison: true, note: "" },
    ...over,
  });
  const useFake = (resultFn) =>
    _overrideComparisonService({ runAllocationComparison: vi.fn(resultFn) });

  beforeEach(() => {
    seedLiveData();
    _overrideComparisonService(null);
  });

  it("completes with stored assignments, metrics, seed, version and snapshot all consistent (real algorithm)", async () => {
    const run = await executeAllocationComparison(params);
    expect(run.status).toBe("completed");
    const stored = (a) => db.allocations.filter((x) => x.algorithm === a).length;
    expect(stored("baseline")).toBe(run.baselineMetrics.totalAssignments);
    expect(stored("optimized")).toBe(run.optimizedMetrics.totalAssignments);
    expect(run.randomSeed).toBe(5);
    expect(run.algorithmVersion).toBeTruthy();
    // elective-group identity survives into the immutable snapshot
    expect(run.inputSnapshot.courses.map((c) => c.electiveGroup)).toEqual(["A", "A", "B"]);
    expect(new Set(run.inputSnapshot.preferences.map((p) => p.electiveGroup))).toEqual(new Set(["A", "B"]));
    expect(run.inputSnapshot.timetable.C1).toBeDefined();
  });

  it("the same seed reproduces the same baseline assignments", async () => {
    await executeAllocationComparison({ ...params, meritRatio: 0, randomRatio: 1 });
    const first = db.allocations.filter((a) => a.algorithm === "baseline").map((a) => `${a.student}:${a.course}`).sort();
    seedLiveData();
    await executeAllocationComparison({ ...params, meritRatio: 0, randomRatio: 1 });
    const second = db.allocations.filter((a) => a.algorithm === "baseline").map((a) => `${a.student}:${a.course}`).sort();
    expect(second).toEqual(first);
  });

  it("the stored snapshot cannot be altered by the algorithm or by later edits to live data", async () => {
    useFake((input) => {
      input.students[0].cgpa = 0; // a misbehaving algorithm mutating its input
      input.courses[0].capacity = 999;
      return fakeResult();
    });
    const run = await executeAllocationComparison(params);
    expect(run.inputSnapshot.students[0].cgpa).toBe(9);
    expect(run.inputSnapshot.courses[0].capacity).toBe(1);
    // later live edits do not touch the stored run
    db.students[0].cgpa = 1;
    db.courses[0].capacity = 50;
    expect(db.run.inputSnapshot.students[0].cgpa).toBe(9);
    expect(db.run.inputSnapshot.courses[0].capacity).toBe(1);
  });

  it("rejects output with an unknown student: nothing persisted, run failed, no misleading metrics", async () => {
    useFake(() =>
      fakeResult({
        baseline: { ...fakeResult().baseline, allocations: [{ studentId: "GHOST", courseId: "C1", preferenceRank: 1 }] },
      })
    );
    await expect(executeAllocationComparison(params)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    expect(db.run.status).toBe("failed");
    expect(db.run.errorSummary).toMatch(/unknown student/);
    expect(db.calls.insertMany).toBe(0);
    expect(db.allocations).toHaveLength(0);
    expect(db.run.baselineMetrics ?? null).toBeNull();
  });

  it("rejects output with an unknown course", async () => {
    useFake(() =>
      fakeResult({
        optimized: { ...fakeResult().optimized, allocations: [{ studentId: "S1", courseId: "NOPE", preferenceRank: 1 }] },
      })
    );
    await expect(executeAllocationComparison(params)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    expect(db.run.status).toBe("failed");
    expect(db.allocations).toHaveLength(0);
  });

  it.each([
    ["missing rank", [{ studentId: "S1", courseId: "C1" }]],
    ["zero rank", [{ studentId: "S1", courseId: "C1", preferenceRank: 0 }]],
    ["non-object entry", [null]],
    ["duplicate pair", [
      { studentId: "S1", courseId: "C1", preferenceRank: 1 },
      { studentId: "S1", courseId: "C1", preferenceRank: 1 },
    ]],
  ])("rejects malformed output: %s", async (_n, allocations) => {
    useFake(() =>
      fakeResult({
        baseline: { ...fakeResult().baseline, allocations, metrics: metrics(allocations.length) },
      })
    );
    await expect(executeAllocationComparison(params)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    expect(db.run.status).toBe("failed");
    expect(db.allocations).toHaveLength(0);
  });

  it("rejects output whose allocations are not an array", async () => {
    useFake(() => fakeResult({ baseline: { ...fakeResult().baseline, allocations: "bad" } }));
    await expect(executeAllocationComparison(params)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    expect(db.run.status).toBe("failed");
  });

  it("rejects metrics that disagree with the produced assignments", async () => {
    useFake(() => fakeResult({ baseline: { ...fakeResult().baseline, metrics: metrics(7) } }));
    await expect(executeAllocationComparison(params)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    expect(db.run.status).toBe("failed");
    expect(db.run.errorSummary).toMatch(/metrics report 7/);
  });

  it("a partial insert failure removes the partial assignments and fails the run", async () => {
    useFake(() => fakeResult());
    db.hooks.insertPartial = true;
    await expect(executeAllocationComparison(params)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    expect(db.calls.deleteMany).toBe(1);
    expect(db.allocations).toHaveLength(0);
    expect(db.run.status).toBe("failed");
    expect(db.run.errorSummary).toMatch(/Persistence failed/);
  });

  it("a persisted-count mismatch fails the run instead of completing it", async () => {
    useFake(() => fakeResult());
    db.hooks.countShort = 1;
    await expect(executeAllocationComparison(params)).rejects.toMatchObject({ code: "PERSISTENCE_FAILED" });
    expect(db.run.status).toBe("failed");
    expect(db.allocations).toHaveLength(0);
  });

  it("an algorithm exception marks the run failed with no assignments", async () => {
    useFake(() => {
      throw new Error("boom");
    });
    await expect(executeAllocationComparison(params)).rejects.toMatchObject({ code: "ALLOCATION_FAILED" });
    expect(db.run.status).toBe("failed");
    expect(db.run.errorSummary).toBe("boom");
    expect(db.allocations).toHaveLength(0);
  });

  it("buildAllocationDocs maps references and never drops records silently", () => {
    const sm = new Map([["S1", "oid-s1"]]);
    const cm = new Map([["C1", "oid-c1"]]);
    const ok = buildAllocationDocs("r", "baseline",
      { allocations: [{ studentId: "S1", courseId: "C1", preferenceRank: 2, phase: "merit" }], metrics: metrics(1) }, sm, cm);
    expect(ok).toEqual([expect.objectContaining({ student: "oid-s1", course: "oid-c1", preferenceRank: 2, status: "proposed" })]);
    expect(() => buildAllocationDocs("r", "baseline",
      { allocations: [{ studentId: "S9", courseId: "C1", preferenceRank: 1 }] }, sm, cm)).toThrow(/unknown student/);
  });
});

// ---------------------------------------------------------------------------
// Phase 4/8/9: publication
// ---------------------------------------------------------------------------
describe("publishAllocationRun - validation of the actual stored assignments", () => {
  beforeEach(seedCompletedRun);

  it("publishes a valid optimized result and ONLY the optimized assignments", async () => {
    const run = await publish("optimized");
    expect(run.status).toBe("published");
    expect(run.selectedAlgorithm).toBe("optimized");
    expect(statusesOf("optimized")).toEqual(["published", "published"]);
    expect(statusesOf("baseline")).toEqual(["proposed", "proposed"]);
    expect(db.run.publicationCheck).toMatchObject({ algorithm: "optimized", valid: true, assignmentCount: 2 });
  });

  it("publishes a valid baseline result and ONLY the baseline assignments", async () => {
    await publish("baseline");
    expect(statusesOf("baseline")).toEqual(["published", "published"]);
    expect(statusesOf("optimized")).toEqual(["proposed", "proposed"]);
  });

  it("a defect in the other algorithm does not block the selected one", async () => {
    db.allocations.push(alloc("baseline", 10, 20, 1)); // baseline now violates capacity/duplicates
    await expect(publish("optimized")).resolves.toMatchObject({ status: "published" });
  });

  const expectRejected = async (algorithm, pattern) => {
    const err = await publish(algorithm).catch((e) => e);
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe("PUBLICATION_VALIDATION_FAILED");
    expect(JSON.stringify(err.details)).toMatch(pattern);
    // nothing was published or claimed
    expect(db.run.status).toBe("completed");
    expect(db.run.selectedAlgorithm).toBeNull();
    expect(statusesOf(algorithm).every((s) => s === "proposed")).toBe(true);
    expect(db.run.publicationCheck.valid).toBe(false);
  };

  it("rejects an assignment referencing a missing student", async () => {
    db.allocations[0].student = id(99);
    await expectRejected("optimized", /missing student/);
  });

  it("rejects an assignment referencing a missing course", async () => {
    db.allocations[0].course = id(98);
    await expectRejected("optimized", /missing course/);
  });

  it("rejects a course from another semester", async () => {
    db.courses[0].semesterId = "OTHER";
    await expectRejected("optimized", /not in semester/);
  });

  it("rejects duplicate assignments", async () => {
    db.allocations.push(alloc("optimized", 10, 20, 1));
    db.run.optimizedMetrics = metrics(3);
    await expectRejected("optimized", /duplicate assignment/);
  });

  it("rejects capacity violations even when cached metrics claim zero violations", async () => {
    db.allocations.push(alloc("optimized", 11, 20, 1)); // C1 capacity is 1
    db.run.optimizedMetrics = metrics(3); // cached counts match, cached violations say 0
    await expectRejected("optimized", /exceeds capacity/);
  });

  it("rejects timetable clashes recomputed from the snapshot", async () => {
    db.allocations.push(alloc("optimized", 10, 21, 2)); // S1: C1 (09-10) + C2 (09:30-10:30)
    db.run.optimizedMetrics = metrics(3);
    await expectRejected("optimized", /timetable clash/);
  });

  it("rejects exceeding the configured max courses per student", async () => {
    db.run.configuration.maxCoursesPerStudent = 1;
    db.allocations.push(alloc("optimized", 10, 22, 1));
    db.run.inputSnapshot.preferences.push({ studentId: "S1", courseId: "C3", rank: 3, electiveGroup: "B" });
    db.run.optimizedMetrics = metrics(3);
    await expectRejected("optimized", /exceeds the course limit/);
  });

  it("rejects an assignment the student never selected", async () => {
    db.allocations.push(alloc("optimized", 10, 22, 1)); // S1 never ranked C3
    db.run.optimizedMetrics = metrics(3);
    await expectRejected("optimized", /did not select/);
  });

  it("rejects an elective-group mismatch between the selecting list and the course", async () => {
    db.run.inputSnapshot.preferences[3].electiveGroup = "A"; // S2 selected C3 under A, but C3 is group B
    await expectRejected("optimized", /group/);
  });

  it("rejects an empty assignment set", async () => {
    db.allocations = db.allocations.filter((a) => a.algorithm !== "optimized");
    db.run.optimizedMetrics = metrics(0);
    await expectRejected("optimized", /empty result/);
  });

  it("rejects stale metrics that do not match the stored assignments", async () => {
    db.run.optimizedMetrics = metrics(5);
    await expectRejected("optimized", /stale/);
  });

  it("rejects a failed stored validation summary or reported violations", async () => {
    db.run.optimizedValidation = { valid: false, errorCount: 1, errorList: ["x"] };
    await expectRejected("optimized", /validation summary/);
  });

  it("rejects a run without an immutable snapshot", async () => {
    db.run.inputSnapshot = { studentCount: 2 };
    await expectRejected("optimized", /snapshot/);
  });

  it("rejects non-completed runs and bad algorithm names", async () => {
    db.run.status = "failed";
    await expect(publish("optimized")).rejects.toMatchObject({ statusCode: 400 });
    await expect(publish("both")).rejects.toMatchObject({ statusCode: 400 });
  });

  it("returns 404 for an unknown run", async () => {
    db.run = null;
    await expect(publish("optimized")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("publishAllocationRun - state policy, idempotency and concurrency", () => {
  beforeEach(seedCompletedRun);

  it("repeating the same publication is idempotent and writes nothing", async () => {
    await publish("optimized");
    const writes = db.calls.updateMany.length;
    const again = await publish("optimized");
    expect(again.status).toBe("published");
    expect(db.calls.updateMany.length).toBe(writes);
  });

  it("changing the algorithm after publication is a 409 and changes nothing", async () => {
    await publish("optimized");
    await expect(publish("baseline")).rejects.toMatchObject({ statusCode: 409 });
    expect(db.run.selectedAlgorithm).toBe("optimized");
    expect(statusesOf("baseline")).toEqual(["proposed", "proposed"]);
  });

  it("concurrent conflicting publications: exactly one wins, loser gets 409 and publishes nothing", async () => {
    const results = await Promise.allSettled([publish("optimized"), publish("baseline")]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect(bad[0].reason.statusCode).toBe(409);

    const winner = db.run.selectedAlgorithm;
    const loser = winner === "optimized" ? "baseline" : "optimized";
    expect(db.run.status).toBe("published");
    expect(statusesOf(winner).every((s) => s === "published")).toBe(true);
    expect(statusesOf(loser).every((s) => s === "proposed")).toBe(true);
    // the loser never issued a single assignment write
    expect(db.calls.updateMany.every((c) => c.algorithm === winner)).toBe(true);
  });

  it("many concurrent identical requests: one claim, the rest are idempotent or 409, state stays consistent", async () => {
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => publish("optimized")));
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    for (const r of results) {
      if (r.status === "rejected") expect(r.reason.statusCode).toBe(409);
    }
    expect(db.run.status).toBe("published");
    expect(db.calls.updateMany.filter((c) => c.status === "published")).toHaveLength(1);
  });

  it("a run being published by another request yields 409", async () => {
    db.run.status = "publishing";
    await expect(publish("optimized")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("failure while marking assignments rolls the run back to completed/proposed", async () => {
    db.hooks.updateManyFails = true;
    await expect(publish("optimized")).rejects.toMatchObject({ code: "PUBLISH_FAILED" });
    expect(db.run.status).toBe("completed");
    expect(db.run.selectedAlgorithm).toBeNull();
    expect(db.run.publishedBy).toBeNull();
    expect(statusesOf("optimized").every((s) => s === "proposed")).toBe(true);
    // and a later retry can succeed
    db.hooks.updateManyFails = false;
    await expect(publish("optimized")).resolves.toMatchObject({ status: "published" });
  });

  it("an incomplete assignment update (count mismatch) is rolled back, not left partial", async () => {
    db.hooks.matchedShort = true;
    await expect(publish("optimized")).rejects.toMatchObject({ code: "PUBLISH_FAILED" });
    expect(db.run.status).toBe("completed");
    expect(statusesOf("optimized").every((s) => s === "proposed")).toBe(true);
  });
});

describe("publishAllocationRun - recovery of an abandoned (stale) claim", () => {
  beforeEach(seedCompletedRun);

  const abandon = (ageMs, algorithm = "optimized") => {
    db.run.status = "publishing";
    db.run.selectedAlgorithm = algorithm;
    db.run.publishedAt = new Date(Date.now() - ageMs);
    db.allocations.filter((a) => a.algorithm === algorithm).forEach((a) => (a.status = "published"));
  };

  it("a FRESH claim still blocks other publishes with 409", async () => {
    abandon(1000);
    await expect(publish("baseline")).rejects.toMatchObject({ statusCode: 409 });
    expect(db.run.status).toBe("publishing");
  });

  it("a stale claim is rolled back and the new publication then succeeds (different algorithm)", async () => {
    abandon(10 * 60 * 1000, "optimized");
    const run = await publish("baseline");
    expect(run.status).toBe("published");
    expect(run.selectedAlgorithm).toBe("baseline");
    expect(statusesOf("baseline").every((s) => s === "published")).toBe(true);
    expect(statusesOf("optimized").every((s) => s === "proposed")).toBe(true);
  });

  it("a stale claim can be re-published with the same algorithm", async () => {
    abandon(10 * 60 * 1000, "optimized");
    const run = await publish("optimized");
    expect(run.status).toBe("published");
    expect(statusesOf("optimized").every((s) => s === "published")).toBe(true);
  });

  it("concurrent requests over a stale claim: one winner, state consistent", async () => {
    abandon(10 * 60 * 1000, "optimized");
    const results = await Promise.allSettled([publish("optimized"), publish("baseline"), publish("baseline")]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    for (const r of results) if (r.status === "rejected") expect(r.reason.statusCode).toBe(409);
    expect(db.run.status).toBe("published");
    const winner = db.run.selectedAlgorithm;
    const other = winner === "optimized" ? "baseline" : "optimized";
    expect(statusesOf(winner).every((s) => s === "published")).toBe(true);
    expect(statusesOf(other).every((s) => s === "proposed")).toBe(true);
  });
});
