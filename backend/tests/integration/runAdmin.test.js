/**
 * tests/integration/runAdmin.test.js
 * Cancel / delete / verify (replay) / CSV export of stored runs, plus the
 * merit-iteration field. Real services, controllers and routes; mocked models
 * and a mocked worker engine.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

vi.mock("../../src/config/env.js", () => ({
  env: {
    port: 5000, nodeEnv: "test", mongoUri: "mongodb://test",
    jwtSecret: "test-secret-long-enough-for-tests-only", jwtExpiresIn: "15m",
    clientOrigin: "http://localhost:5173", rateLimitLoginMax: 100, rateLimitLoginWindowMs: 900000,
    seedAdminEmail: "", seedAdminPassword: "",
    isDevelopment: false, isTest: true, isProduction: false,
  },
}));
vi.mock("../../src/config/db.js", () => ({
  connectDB: vi.fn().mockResolvedValue(undefined),
  disconnectDB: vi.fn().mockResolvedValue(undefined),
  getDbStatus: vi.fn().mockReturnValue("connected"),
}));

const adminUser = { _id: "507f1f77bcf86cd799440002", role: "admin", isActive: true };
const facultyUser = { _id: "507f1f77bcf86cd799440003", role: "faculty", isActive: true };
const studentUser = { _id: "507f1f77bcf86cd799440004", role: "student", student: "507f1f77bcf86cd799440005", isActive: true };
const mockUserFindById = vi.fn();
vi.mock("../../src/models/User.js", () => ({
  default: {
    findById: () => ({ select: () => ({ lean: mockUserFindById }) }),
    findOne: vi.fn(), exists: vi.fn(), create: vi.fn(),
  },
}));

// ---- fake stores -------------------------------------------------------------
const RUN_ID = "507f1f77bcf86cd799440010";
const runs = {};
let allocRows = [];
const calls = { markCancelled: [], deleteFilter: [], allocDeleteMany: [] };
let raceLost = false;

vi.mock("../../src/models/AllocationRun.js", () => ({
  default: {
    findById: (id) => {
      const q = { select: () => q, populate: () => q, lean: async () => runs[id] ?? null };
      return q;
    },
    findOneAndUpdate: (filter, update) => ({
      lean: async () => {
        calls.markCancelled.push({ filter, update });
        if (raceLost || !runs[filter._id] || runs[filter._id].status !== filter.status) return null;
        runs[filter._id] = { ...runs[filter._id], ...update.$set };
        return runs[filter._id];
      },
    }),
    findOneAndDelete: (filter) => ({
      lean: async () => {
        calls.deleteFilter.push(filter);
        const r = runs[filter._id];
        if (!r || !filter.status.$in.includes(r.status)) return null;
        delete runs[filter._id];
        return r;
      },
    }),
  },
}));
vi.mock("../../src/models/Allocation.js", () => ({
  default: {
    find: () => {
      const q = {};
      q.populate = () => q;
      q.sort = () => q;
      q.lean = async () => allocRows;
      return q;
    },
    deleteMany: async (f) => { calls.allocDeleteMany.push(f); return { deletedCount: allocRows.length }; },
    countDocuments: async () => allocRows.length,
  },
}));
vi.mock("../../src/models/Student.js", () => ({ default: { findOne: vi.fn(), findById: vi.fn() } }));
vi.mock("../../src/models/Course.js", () => ({ default: { findOne: vi.fn(), find: vi.fn() } }));
vi.mock("../../src/models/Preference.js", () => ({ default: { find: vi.fn() } }));

// Partial mock of the engine: real everything except the worker-facing pieces.
const mockCancelActive = vi.fn();
const mockReplay = vi.fn();
vi.mock("../../src/services/allocationEngine.service.js", async (importOriginal) => ({
  ...(await importOriginal()),
  cancelActiveRun: (...a) => mockCancelActive(...a),
  runFromSnapshot: (...a) => mockReplay(...a),
}));

let app;
let buildAllocationDocs;
beforeAll(async () => {
  process.env.JWT_SECRET = "test-secret-long-enough-for-tests-only";
  app = (await import("../../src/app.js")).default;
  ({ buildAllocationDocs } = await import("../../src/services/allocation.service.js"));
});

const cookie = (u) =>
  `token=${jwt.sign({ sub: u._id, role: u.role }, "test-secret-long-enough-for-tests-only", { expiresIn: "15m" })}`;
const as = (user) => ({
  get: (p) => request(app).get(p).set("Cookie", cookie(user)),
  post: (p) => request(app).post(p).set("Cookie", cookie(user)),
  del: (p) => request(app).delete(p).set("Cookie", cookie(user)),
});
const admin = as(adminUser);

const snapshot = {
  studentCount: 2, courseCount: 1, preferenceCount: 2, timetableIncluded: true,
  students: [{ id: "S1", name: "Asha", cgpa: 9 }, { id: "S2", name: "Ravi", cgpa: 8 }],
  courses: [{ id: "C1", name: "Algo", capacity: 2 }],
  preferences: [{ studentId: "S1", courseId: "C1", rank: 1 }, { studentId: "S2", courseId: "C1", rank: 1 }],
  timetable: { C1: [{ day: "Mon", start: "09:00", end: "10:00" }] },
};

function makeRun(extra = {}) {
  return {
    _id: RUN_ID, semesterId: "SEM 1/A", status: "completed", algorithmsRun: ["baseline", "optimized"],
    selectedAlgorithm: null, algorithmVersion: "1.1.0", randomSeed: 42,
    configuration: { maxCoursesPerStudent: 2, meritRatio: 0.75, randomRatio: 0.25, timetableValidationEnabled: true },
    inputSnapshot: snapshot, ...extra,
  };
}

const stored = (sid, code, rank, phase, name = "N", extra = {}) => ({
  student: { studentId: sid, name, cgpa: 8, department: "CSE" },
  course: { courseCode: code, title: "Algo", electiveGroup: "A" },
  preferenceRank: rank, phase, iteration: phase === "merit" ? 1 : null, status: "proposed", ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(runs)) delete runs[k];
  runs[RUN_ID] = makeRun();
  allocRows = [];
  calls.markCancelled.length = 0; calls.deleteFilter.length = 0; calls.allocDeleteMany.length = 0;
  raceLost = false;
  mockUserFindById.mockResolvedValue(adminUser);
});

describe("access control", () => {
  const endpoints = [
    ["post", `/api/v1/allocations/runs/${RUN_ID}/cancel`],
    ["del", `/api/v1/allocations/runs/${RUN_ID}`],
    ["post", `/api/v1/allocations/runs/${RUN_ID}/verify`],
  ];
  it("management actions are admin-only", async () => {
    for (const [m, p] of endpoints) {
      expect((await request(app)[m === "del" ? "delete" : m](p)).status).toBe(401);
      mockUserFindById.mockResolvedValue(facultyUser);
      expect((await as(facultyUser)[m](p)).status).toBe(403);
      mockUserFindById.mockResolvedValue(studentUser);
      expect((await as(studentUser)[m](p)).status).toBe(403);
    }
  });
  it("export is closed to students and logged-out users, open to faculty", async () => {
    const p = `/api/v1/allocations/runs/${RUN_ID}/export?algorithm=baseline`;
    expect((await request(app).get(p)).status).toBe(401);
    mockUserFindById.mockResolvedValue(studentUser);
    expect((await as(studentUser).get(p)).status).toBe(403);
    mockUserFindById.mockResolvedValue(facultyUser);
    expect((await as(facultyUser).get(p)).status).toBe(200);
  });
});

describe("POST /runs/:id/cancel", () => {
  it("unknown or malformed id is 404", async () => {
    expect((await admin.post("/api/v1/allocations/runs/507f1f77bcf86cd7994400ff/cancel")).status).toBe(404);
    expect((await admin.post("/api/v1/allocations/runs/not-an-id/cancel")).status).toBe(404);
  });

  it("only a running run can be cancelled", async () => {
    for (const status of ["completed", "failed", "cancelled", "published", "publishing"]) {
      runs[RUN_ID] = makeRun({ status });
      expect((await admin.post(`/api/v1/allocations/runs/${RUN_ID}/cancel`)).status).toBe(409);
    }
    expect(mockCancelActive).not.toHaveBeenCalled();
  });

  it("marks the run cancelled (conditionally), stops the worker and clears partial assignments", async () => {
    runs[RUN_ID] = makeRun({ status: "running" });
    mockCancelActive.mockReturnValue(true);
    const res = await admin.post(`/api/v1/allocations/runs/${RUN_ID}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ workerStopped: true, run: { status: "cancelled" } });
    expect(calls.markCancelled[0].filter).toEqual({ _id: RUN_ID, status: "running" });
    expect(mockCancelActive).toHaveBeenCalledWith(RUN_ID);
    expect(calls.allocDeleteMany).toHaveLength(1);
  });

  it("a stale running run with no live worker is still cancelled", async () => {
    runs[RUN_ID] = makeRun({ status: "running" });
    mockCancelActive.mockReturnValue(false);
    const res = await admin.post(`/api/v1/allocations/runs/${RUN_ID}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.data.workerStopped).toBe(false);
  });

  it("losing a race against completion is 409 and stops nothing", async () => {
    runs[RUN_ID] = makeRun({ status: "running" });
    raceLost = true;
    expect((await admin.post(`/api/v1/allocations/runs/${RUN_ID}/cancel`)).status).toBe(409);
    expect(mockCancelActive).not.toHaveBeenCalled();
  });
});

describe("DELETE /runs/:id", () => {
  it("unknown id is 404", async () => {
    expect((await admin.del("/api/v1/allocations/runs/507f1f77bcf86cd7994400ff")).status).toBe(404);
  });

  it("deletes completed, failed and cancelled runs and their assignments", async () => {
    for (const status of ["completed", "failed", "cancelled"]) {
      runs[RUN_ID] = makeRun({ status });
      allocRows = [stored("S1", "C1", 1, "merit")];
      const res = await admin.del(`/api/v1/allocations/runs/${RUN_ID}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ status, removedAssignments: 1 });
      expect(runs[RUN_ID]).toBeUndefined();
    }
    expect(calls.allocDeleteMany).toHaveLength(3);
  });

  it("the delete filter can never match published, publishing or running runs", async () => {
    await admin.del(`/api/v1/allocations/runs/${RUN_ID}`);
    const allowed = calls.deleteFilter[0].status.$in;
    expect(allowed.sort()).toEqual(["cancelled", "completed", "failed"]);
  });

  it("refuses a published or publishing run and keeps everything", async () => {
    for (const status of ["published", "publishing"]) {
      runs[RUN_ID] = makeRun({ status });
      const res = await admin.del(`/api/v1/allocations/runs/${RUN_ID}`);
      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/cannot be deleted/);
      expect(runs[RUN_ID]).toBeDefined();
    }
    expect(calls.allocDeleteMany).toHaveLength(0);
  });

  it("a running run must be cancelled first", async () => {
    runs[RUN_ID] = makeRun({ status: "running" });
    const res = await admin.del(`/api/v1/allocations/runs/${RUN_ID}`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/cancel it first/);
  });
});

describe("POST /runs/:id/verify (replay)", () => {
  const verify = (q = "") => admin.post(`/api/v1/allocations/runs/${RUN_ID}/verify${q}`);
  const replayResult = (allocations, version = "1.1.0") => ({ allocations, configuration: { algorithmVersion: version } });

  it("replays the baseline from the stored snapshot, seed, ratios and limits", async () => {
    allocRows = [stored("S1", "C1", 1, "merit"), stored("S2", "C1", 1, "random")];
    mockReplay.mockResolvedValue(replayResult([
      { studentId: "S1", courseId: "C1", preferenceRank: 1, phase: "merit", iteration: 1 },
      { studentId: "S2", courseId: "C1", preferenceRank: 1, phase: "random" },
    ]));
    const res = await verify("?algorithm=baseline");
    expect(res.status).toBe(200);
    expect(res.body.data.allMatch).toBe(true);
    expect(res.body.data.results[0]).toMatchObject({ algorithm: "baseline", matches: true, sameVersion: true, seed: 42, storedCount: 2, replayedCount: 2 });
    const arg = mockReplay.mock.calls[0][0];
    expect(arg.algorithm).toBe("baseline");
    expect(arg.options).toMatchObject({ seed: 42, meritRatio: 0.75, randomRatio: 0.25, maxCoursesPerStudent: 2 });
    expect(arg.snapshot.timetable).toEqual(snapshot.timetable);
    expect(arg.snapshot.students).toHaveLength(2);
  });

  it("reports differences in both directions when the replay disagrees", async () => {
    allocRows = [stored("S1", "C1", 1, "merit"), stored("S2", "C1", 1, "random")];
    mockReplay.mockResolvedValue(replayResult([
      { studentId: "S1", courseId: "C1", preferenceRank: 1, phase: "merit" },
      { studentId: "S9", courseId: "C1", preferenceRank: 2, phase: "random" },
    ]));
    const res = await verify("?algorithm=baseline");
    expect(res.body.data.allMatch).toBe(false);
    const r = res.body.data.results[0];
    expect(r.matches).toBe(false);
    expect(r.onlyInStored).toEqual([{ studentId: "S2", courseId: "C1", preferenceRank: 1, phase: "random" }]);
    expect(r.onlyInReplay).toEqual([{ studentId: "S9", courseId: "C1", preferenceRank: 2, phase: "random" }]);
  });

  it("verifies both algorithms when none is named; the optimizer is not given a seed", async () => {
    allocRows = [stored("S1", "C1", 1, null)];
    mockReplay.mockResolvedValue(replayResult([{ studentId: "S1", courseId: "C1", preferenceRank: 1 }]));
    const res = await verify();
    expect(res.body.data.results.map((r) => r.algorithm)).toEqual(["baseline", "optimized"]);
    const optCall = mockReplay.mock.calls.find((c) => c[0].algorithm === "optimized")[0];
    expect(optCall.options.seed).toBeUndefined();
    expect(res.body.data.allMatch).toBe(true);
  });

  describe("an optimizer held to the baseline", () => {
    const floored = (cfg = {}, extra = {}) => makeRun({
      configuration: {
        maxCoursesPerStudent: 2, meritRatio: 0.7, randomRatio: 0.3, timetableValidationEnabled: true,
        optimizerFloor: "baseline", cgpaPriority: true, ...cfg,
      },
      ...extra,
    });

    it("is replayed with the floor, the CGPA setting, and the stored seed and split", async () => {
      runs[RUN_ID] = floored();
      allocRows = [stored("S1", "C1", 1, null)];
      mockReplay.mockResolvedValue(replayResult([{ studentId: "S1", courseId: "C1", preferenceRank: 1 }]));

      const res = await verify("?algorithm=optimized");
      expect(res.status).toBe(200);
      expect(mockReplay.mock.calls[0][0].options).toMatchObject({
        optimizerFloor: "baseline", cgpaPriority: true, seed: 42, meritRatio: 0.7, randomRatio: 0.3,
      });
    });

    it("cannot be replayed without the seed that produced its baseline", async () => {
      runs[RUN_ID] = floored({}, { randomSeed: null });
      const res = await verify("?algorithm=optimized");
      expect(res.body.data.results[0]).toMatchObject({ algorithm: "optimized", matches: null });
      expect(res.body.data.results[0].reason).toMatch(/seed/);
      expect(mockReplay).not.toHaveBeenCalled();
    });

    it("a run stored before the floor existed is replayed unconstrained, as it was computed", async () => {
      runs[RUN_ID] = makeRun(); // no optimizerFloor in its configuration
      allocRows = [stored("S1", "C1", 1, null)];
      mockReplay.mockResolvedValue(replayResult([{ studentId: "S1", courseId: "C1", preferenceRank: 1 }]));

      await verify("?algorithm=optimized");
      expect(mockReplay.mock.calls[0][0].options).toMatchObject({ optimizerFloor: "none", cgpaPriority: false });
      expect(mockReplay.mock.calls[0][0].options.seed).toBeUndefined();
    });
  });

  it("flags a version change as a possible cause of a mismatch", async () => {
    mockReplay.mockResolvedValue(replayResult([], "9.9.9"));
    const r = (await verify("?algorithm=optimized")).body.data.results[0];
    expect(r).toMatchObject({ sameVersion: false, storedVersion: "1.1.0", currentVersion: "9.9.9" });
    expect(r.note).toMatch(/version differs/);
  });

  it("a baseline run without a stored seed cannot be replayed (matches: null)", async () => {
    runs[RUN_ID] = makeRun({ randomSeed: null, algorithmsRun: ["baseline"] });
    const res = await verify();
    expect(res.status).toBe(200);
    expect(res.body.data.results[0].matches).toBeNull();
    expect(res.body.data.allMatch).toBe(false);
    expect(mockReplay).not.toHaveBeenCalled();
  });

  it("a run without a snapshot is 400", async () => {
    runs[RUN_ID] = makeRun({ inputSnapshot: { studentCount: 2 } });
    expect((await verify()).status).toBe(400);
  });

  it("only completed, publishing or published runs; algorithm must exist in the run", async () => {
    runs[RUN_ID] = makeRun({ status: "failed" });
    expect((await verify()).status).toBe(400);
    runs[RUN_ID] = makeRun({ algorithmsRun: ["baseline"] });
    expect((await verify("?algorithm=optimized")).status).toBe(400);
    expect((await verify("?algorithm=nonsense")).status).toBe(400);
  });

  it("a replay timeout is 504 and an engine failure is 500 without internals", async () => {
    mockReplay.mockRejectedValueOnce(Object.assign(new Error("slow"), { code: "ALLOCATION_TIMEOUT" }));
    expect((await verify("?algorithm=baseline")).status).toBe(504);
    mockReplay.mockRejectedValueOnce(new Error("secret internal detail"));
    const res = await verify("?algorithm=baseline");
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("secret internal detail");
  });
});

describe("GET /runs/:id/export (CSV)", () => {
  const exp = (q = "?algorithm=baseline") => admin.get(`/api/v1/allocations/runs/${RUN_ID}/export${q}`);

  it("returns an attachment with a safe filename, BOM, header and one row per assignment", async () => {
    allocRows = [stored("S2", "C1", 1, "random", "Ravi"), stored("S1", "C1", 1, "merit", "Asha")];
    const res = await exp();
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="allocation-SEM_1_A-baseline-440010.csv"');
    const text = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe("runId,semesterId,algorithm,studentId,studentName,cgpa,department,courseCode,courseTitle,electiveGroup,preferenceRank,phase,iteration,status");
    expect(lines).toHaveLength(3);
    expect(lines[1].split(",")[3]).toBe("S1"); // sorted by student id
    expect(lines[1]).toContain(",merit,1,proposed");
    expect(lines[2]).toContain(",random,,proposed"); // random rows have no iteration
  });

  it("neutralizes spreadsheet formulas and escapes commas, quotes and line breaks", async () => {
    allocRows = [
      stored("S1", "C1", 1, "merit", "=HYPERLINK(\"http://evil\")"),
      stored("S2", "C1", 1, "random", "Doe, Jane"),
      stored("S3", "C1", 1, "random", "Line\nBreak"),
      stored("S4", "C1", 1, "random", "+cmd|calc"),
    ];
    const text = (await exp()).text;
    expect(text).toContain("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(text).toContain("\"Doe, Jane\"");
    expect(text).toContain("\"Line\nBreak\"");
    expect(text).toContain("'+cmd|calc");
    expect(text).not.toMatch(/,=HYPERLINK/);
  });

  it("needs an explicit algorithm for an unpublished two-algorithm run, but not a published one", async () => {
    expect((await exp("")).status).toBe(400);
    runs[RUN_ID] = makeRun({ status: "published", selectedAlgorithm: "optimized" });
    const res = await exp("");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("-optimized-");
  });

  it("a run that is not completed has nothing to export", async () => {
    runs[RUN_ID] = makeRun({ status: "failed" });
    expect((await exp()).status).toBe(400);
  });

  it("rejects an unknown algorithm", async () => {
    expect((await exp("?algorithm=x")).status).toBe(400);
  });
});

describe("merit iteration is stored on baseline assignments", () => {
  it("buildAllocationDocs keeps iteration for merit rows and null otherwise", () => {
    const studentMap = new Map([["S1", "oid-s1"], ["S2", "oid-s2"], ["S3", "oid-s3"]]);
    const courseMap = new Map([["C1", "oid-c1"]]);
    const docs = buildAllocationDocs("run1", "baseline", {
      allocations: [
        { studentId: "S1", courseId: "C1", preferenceRank: 1, phase: "merit", iteration: 2 },
        { studentId: "S2", courseId: "C1", preferenceRank: 2, phase: "random" },
        { studentId: "S3", courseId: "C1", preferenceRank: 1 },
      ],
      metrics: { totalAssignments: 3 },
    }, studentMap, courseMap);
    expect(docs.map((d) => d.iteration)).toEqual([2, null, null]);
  });
});
