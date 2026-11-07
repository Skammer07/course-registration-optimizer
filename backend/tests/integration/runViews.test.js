/**
 * tests/integration/runViews.test.js
 * Dashboard views of a stored run: summary, by-student, by-course, and the
 * extra filters/sorting on /results. Real service + controllers + routes,
 * mocked models.
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
let allocRowsBy = null; // optional per-algorithm rows
const allocFinds = [];
const studentLookups = [];
const courseLookups = [];
let knownStudent = null;
let knownCourse = null;

vi.mock("../../src/models/AllocationRun.js", () => ({
  default: {
    findById: (id) => {
      const q = { select: () => q, populate: () => q, lean: async () => runs[id] ?? null };
      return q;
    },
  },
}));
vi.mock("../../src/models/Allocation.js", () => ({
  default: {
    find: (filter) => {
      const q = { sortArg: null };
      allocFinds.push({ filter, q });
      q.populate = () => q;
      q.sort = (s) => { q.sortArg = s; return q; };
      q.skip = () => q;
      q.limit = () => q;
      q.lean = async () => allocRowsBy?.[filter.algorithm] ?? allocRows;
      return q;
    },
    countDocuments: async () => allocRows.length,
  },
}));
vi.mock("../../src/models/Student.js", () => ({
  default: {
    findOne: (f) => { studentLookups.push(f); return { select: () => ({ lean: async () => knownStudent }) }; },
    findById: vi.fn(),
  },
}));
vi.mock("../../src/models/Course.js", () => ({
  default: {
    findOne: (f) => { courseLookups.push(f); return { select: () => ({ lean: async () => knownCourse }) }; },
    find: vi.fn(),
  },
}));
vi.mock("../../src/models/Preference.js", () => ({ default: { find: vi.fn() } }));

let app;
beforeAll(async () => {
  process.env.JWT_SECRET = "test-secret-long-enough-for-tests-only";
  app = (await import("../../src/app.js")).default;
});

const cookie = (u) =>
  `token=${jwt.sign({ sub: u._id, role: u.role }, "test-secret-long-enough-for-tests-only", { expiresIn: "15m" })}`;
const get = (path, user = adminUser) => request(app).get(path).set("Cookie", cookie(user));

const metrics = (o) => ({
  totalAssignments: 2, studentsWithAtLeastOneCourse: 2, studentsWithTwoCourses: 0, unallocatedStudents: 1,
  capacityUtilization: 0.67, rank1Assignments: 2, rank2Assignments: 0, averagePreferenceRank: 1,
  constraintViolations: 0, timetableClashes: 0, ...o,
});

function makeRun(extra = {}) {
  return {
    _id: RUN_ID, semesterId: "SEM-1", status: "published", algorithmsRun: ["baseline", "optimized"],
    selectedAlgorithm: "baseline", publishedAt: new Date("2026-01-01T00:00:00Z"), algorithmVersion: "1.1.0",
    randomSeed: 42, createdAt: new Date("2025-12-31T00:00:00Z"), totalRuntimeMs: 12,
    configuration: { maxCoursesPerStudent: 2, meritRatio: 0.75, randomRatio: 0.25, timetableValidationEnabled: true },
    baselineMetrics: metrics({}),
    optimizedMetrics: metrics({ totalAssignments: 3, unallocatedStudents: 0, averagePreferenceRank: 1.33 }),
    baselineRuntimeMs: 1, optimizedRuntimeMs: 6,
    baselineValidation: { valid: true, errorCount: 0, errorList: [] },
    optimizedValidation: { valid: true, errorCount: 0, errorList: [] },
    algorithmDetails: {
      baseline: { phaseSummary: { merit: { allocated: 1 }, random: { allocated: 1 } }, assumptions: ["a"] },
      optimized: { assumptions: { meritRandomQuotasPreserved: false } },
    },
    inputWarnings: { skippedPreferences: 0, droppedCourseEntries: 0, messages: ["warn-1"] },
    inputSnapshot: {
      studentCount: 3, courseCount: 2, preferenceCount: 4, timetableIncluded: true,
      students: [
        { id: "S1", name: "Asha", cgpa: 9 }, { id: "S2", name: "Ravi", cgpa: 8 }, { id: "S3", name: "Meera", cgpa: 7 },
      ],
      courses: [
        { id: "C1", name: "Algorithms", capacity: 2, electiveGroup: "A" },
        { id: "C2", name: "Machine Learning", capacity: 1, electiveGroup: "A" },
      ],
      preferences: [
        { studentId: "S1", courseId: "C1", rank: 1 }, { studentId: "S1", courseId: "C2", rank: 2 },
        { studentId: "S2", courseId: "C1", rank: 1 }, { studentId: "S3", courseId: "C1", rank: 1 },
      ],
    },
    ...extra,
  };
}

const row = (sid, name, cgpa, code, title, rank, phase) => ({
  student: { studentId: sid, name, cgpa }, course: { courseCode: code, title, capacity: 2, electiveGroup: "A" },
  preferenceRank: rank, phase,
});

beforeEach(() => {
  vi.clearAllMocks();
  allocRowsBy = null;
  allocFinds.length = 0; studentLookups.length = 0; courseLookups.length = 0;
  knownStudent = null; knownCourse = null;
  for (const k of Object.keys(runs)) delete runs[k];
  runs[RUN_ID] = makeRun();
  allocRows = [
    row("S1", "Asha", 9, "C1", "Algorithms", 1, "merit"),
    row("S2", "Ravi", 8, "C1", "Algorithms", 1, "random"),
  ];
  mockUserFindById.mockResolvedValue(adminUser);
});

describe("access control", () => {
  const paths = [
    `/api/v1/allocations/runs/${RUN_ID}/summary`,
    `/api/v1/allocations/runs/${RUN_ID}/results/by-student`,
    `/api/v1/allocations/runs/${RUN_ID}/results/by-course`,
  ];
  it("require login", async () => {
    for (const p of paths) expect((await request(app).get(p)).status).toBe(401);
  });
  it("are closed to students", async () => {
    mockUserFindById.mockResolvedValue(studentUser);
    for (const p of paths) expect((await get(p, studentUser)).status).toBe(403);
  });
  it("are open to faculty", async () => {
    mockUserFindById.mockResolvedValue(facultyUser);
    for (const p of paths) expect((await get(p, facultyUser)).status).toBe(200);
  });
  it("unknown or malformed run id is 404", async () => {
    expect((await get("/api/v1/allocations/runs/507f1f77bcf86cd7994400ff/summary")).status).toBe(404);
    expect((await get("/api/v1/allocations/runs/not-an-id/summary")).status).toBe(404);
  });
});

describe("GET /runs/:id/summary", () => {
  it("returns both algorithms side by side with optimized-minus-baseline differences", async () => {
    const res = await get(`/api/v1/allocations/runs/${RUN_ID}/summary`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.algorithms.baseline.metrics.totalAssignments).toBe(2);
    expect(d.algorithms.optimized.metrics.totalAssignments).toBe(3);
    expect(d.comparison.available).toBe(true);
    expect(d.comparison.difference).toMatchObject({ totalAssignments: 1, unallocatedStudents: -1, runtimeMs: 5 });
    expect(d.comparison.difference.averagePreferenceRank).toBeCloseTo(0.33, 2);
    expect(d.comparison.note).toMatch(/No winner is declared/);
  });

  it("carries policy details, validation, runtimes, publication and counts", async () => {
    const d = (await get(`/api/v1/allocations/runs/${RUN_ID}/summary`)).body.data;
    expect(d.algorithms.optimized.details.assumptions.meritRandomQuotasPreserved).toBe(false);
    expect(d.algorithms.baseline.details.phaseSummary.merit.allocated).toBe(1);
    expect(d.algorithms.baseline.validation).toMatchObject({ valid: true, errorCount: 0 });
    expect(d.algorithms.baseline.published).toBe(true);
    expect(d.algorithms.optimized.published).toBe(false);
    expect(d.run).toMatchObject({ selectedAlgorithm: "baseline", randomSeed: 42, inputCounts: { students: 3, courses: 2, preferences: 4 } });
    expect(d.comparison.warnings).toContain("warn-1");
  });

  it("never returns the input snapshot lists", async () => {
    const body = JSON.stringify((await get(`/api/v1/allocations/runs/${RUN_ID}/summary`)).body);
    expect(body).not.toContain("Meera");
    expect(body).not.toContain('"cgpa"');
  });

  it("a single-algorithm run has no comparison", async () => {
    runs[RUN_ID] = makeRun({ algorithmsRun: ["baseline"], optimizedMetrics: null, optimizedValidation: null, selectedAlgorithm: null, status: "completed" });
    const d = (await get(`/api/v1/allocations/runs/${RUN_ID}/summary`)).body.data;
    expect(d.algorithms.optimized).toBeNull();
    expect(d.comparison).toMatchObject({ available: false, difference: null });
  });

  it("a failed run still returns a summary with its error", async () => {
    runs[RUN_ID] = makeRun({ status: "failed", errorSummary: "boom", baselineMetrics: null, optimizedMetrics: null });
    const res = await get(`/api/v1/allocations/runs/${RUN_ID}/summary`);
    expect(res.status).toBe(200);
    expect(res.body.data.run.errorSummary).toBe("boom");
    expect(res.body.data.comparison.available).toBe(false);
  });
});

describe("GET /runs/:id/results/by-student", () => {
  const url = (q = "") => `/api/v1/allocations/runs/${RUN_ID}/results/by-student${q}`;

  it("defaults to the published algorithm and includes unallocated students", async () => {
    const d = (await get(url())).body.data;
    expect(d.algorithm).toBe("baseline");
    expect(d.total).toBe(3);
    const byId = Object.fromEntries(d.students.map((s) => [s.studentId, s]));
    expect(byId.S1).toMatchObject({ status: "allocated", coursesAllocated: 1, averageRank: 1 });
    expect(byId.S1.courses[0]).toMatchObject({ courseCode: "C1", preferenceRank: 1, phase: "merit" });
    expect(byId.S3).toMatchObject({ status: "unallocated", coursesAllocated: 0, courses: [], averageRank: null });
  });

  it("the row counts agree with the stored assignment count", async () => {
    const d = (await get(url("?limit=200"))).body.data;
    expect(d.students.reduce((n, s) => n + s.coursesAllocated, 0)).toBe(allocRows.length);
  });

  it("filters by status and searches id or name (case-insensitive)", async () => {
    expect((await get(url("?status=unallocated"))).body.data.students.map((s) => s.studentId)).toEqual(["S3"]);
    expect((await get(url("?status=allocated"))).body.data.total).toBe(2);
    expect((await get(url("?search=RAVI"))).body.data.students.map((s) => s.studentId)).toEqual(["S2"]);
    expect((await get(url("?search=s3"))).body.data.students.map((s) => s.studentId)).toEqual(["S3"]);
    expect((await get(url("?search=zzz"))).body.data.total).toBe(0);
  });

  it("sorts and paginates", async () => {
    expect((await get(url("?sort=cgpa"))).body.data.students.map((s) => s.studentId)).toEqual(["S1", "S2", "S3"]);
    expect((await get(url("?sort=name"))).body.data.students.map((s) => s.name)).toEqual(["Asha", "Meera", "Ravi"]);
    const p2 = (await get(url("?limit=2&page=2"))).body.data;
    expect(p2).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2 });
    expect(p2.students).toHaveLength(1);
  });

  it("queries only the selected algorithm's rows", async () => {
    await get(url("?algorithm=optimized"));
    expect(allocFinds.some((f) => f.filter.algorithm === "optimized")).toBe(true);
  });

  describe("comparison with the other algorithm", () => {
    beforeEach(() => {
      allocRowsBy = {
        baseline: [row("S1", "Asha", 9, "C1", "Algorithms", 1, "merit"), row("S2", "Ravi", 8, "C1", "Algorithms", 1, "merit")],
        optimized: [row("S1", "Asha", 9, "C1", "Algorithms", 1), row("S2", "Ravi", 8, "C2", "Machine Learning", 2), row("S3", "Meera", 7, "C1", "Algorithms", 1)],
      };
    });

    it("sets each student's result beside the other algorithm's and flags the differences", async () => {
      const d = (await get(url("?algorithm=baseline"))).body.data;
      expect(d.compare).toEqual({ available: true, otherAlgorithm: "optimized", differing: 2, total: 3 });
      const byId = Object.fromEntries(d.students.map((s) => [s.studentId, s]));
      expect(byId.S1.differs).toBe(false);
      expect(byId.S2).toMatchObject({ differs: true, other: { algorithm: "optimized", coursesAllocated: 1, averageRank: 2 } });
      expect(byId.S2.other.courses[0].courseCode).toBe("C2");
      expect(byId.S3).toMatchObject({ differs: true, status: "unallocated" });
      expect(byId.S3.other.coursesAllocated).toBe(1);
    });

    it("is symmetric: viewing the optimizer shows the baseline as the other", async () => {
      const d = (await get(url("?algorithm=optimized"))).body.data;
      expect(d.compare).toMatchObject({ otherAlgorithm: "baseline", differing: 2 });
    });

    it("can show only the differing or only the unchanged students", async () => {
      expect((await get(url("?algorithm=baseline&status=differs"))).body.data.students.map((s) => s.studentId)).toEqual(["S2", "S3"]);
      expect((await get(url("?algorithm=baseline&status=same"))).body.data.students.map((s) => s.studentId)).toEqual(["S1"]);
    });

    it("a single-algorithm run has no comparison", async () => {
      runs[RUN_ID] = makeRun({ algorithmsRun: ["baseline"], selectedAlgorithm: null, status: "completed" });
      const d = (await get(url())).body.data;
      expect(d.compare).toMatchObject({ available: false, otherAlgorithm: null, differing: 0 });
      expect(d.students[0].other).toBeUndefined();
    });
  });

  it("two algorithms and nothing published needs an explicit algorithm", async () => {
    runs[RUN_ID] = makeRun({ selectedAlgorithm: null, status: "completed" });
    expect((await get(url())).status).toBe(400);
    expect((await get(url("?algorithm=baseline"))).status).toBe(200);
  });

  it("an algorithm the run does not contain is 400", async () => {
    runs[RUN_ID] = makeRun({ algorithmsRun: ["baseline"], selectedAlgorithm: null, status: "completed" });
    expect((await get(url("?algorithm=optimized"))).status).toBe(400);
    expect((await get(url())).body.data.algorithm).toBe("baseline");
  });

  it("a run that is not completed has no viewable results", async () => {
    runs[RUN_ID] = makeRun({ status: "failed" });
    expect((await get(url())).status).toBe(400);
  });

  it("rejects bad query values", async () => {
    for (const q of ["?sort=hacker", "?status=maybe", "?limit=0", "?limit=999", "?page=0", "?algorithm=x"]) {
      expect((await get(url(q))).status).toBe(400);
    }
  });
});

describe("GET /runs/:id/results/by-course", () => {
  const url = (q = "") => `/api/v1/allocations/runs/${RUN_ID}/results/by-course${q}`;

  it("reports capacity, seats filled, utilization and demand", async () => {
    const d = (await get(url())).body.data;
    const byCode = Object.fromEntries(d.courses.map((c) => [c.courseCode, c]));
    expect(byCode.C1).toMatchObject({ capacity: 2, assignedCount: 2, seatsRemaining: 0, utilization: 1, demand: 3 });
    expect(byCode.C1.byPhase).toEqual({ merit: 1, random: 1 });
    expect(byCode.C1.students.map((s) => s.studentId)).toEqual(["S1", "S2"]);
    expect(byCode.C2).toMatchObject({ capacity: 1, assignedCount: 0, seatsRemaining: 1, utilization: 0, demand: 1 });
  });

  it("seat totals agree with the stored assignments", async () => {
    const d = (await get(url())).body.data;
    expect(d.courses.reduce((n, c) => n + c.assignedCount, 0)).toBe(allocRows.length);
  });

  it("can omit the student lists, search and sort", async () => {
    expect((await get(url("?includeStudents=false"))).body.data.courses[0]).not.toHaveProperty("students");
    expect((await get(url("?search=machine"))).body.data.courses.map((c) => c.courseCode)).toEqual(["C2"]);
    expect((await get(url("?sort=demand"))).body.data.courses.map((c) => c.courseCode)).toEqual(["C1", "C2"]);
    expect((await get(url("?sort=utilization"))).body.data.courses[0].courseCode).toBe("C1");
  });

  it("rejects bad query values", async () => {
    for (const q of ["?sort=x", "?includeStudents=maybe", "?limit=500"]) {
      expect((await get(url(q))).status).toBe(400);
    }
  });
});

describe("GET /runs/:id/results filters and sorting", () => {
  const url = (q = "") => `/api/v1/allocations/runs/${RUN_ID}/results${q}`;

  it("passes phase, rank and algorithm into the query", async () => {
    await get(url("?algorithm=baseline&phase=random&rank=2"));
    expect(allocFinds.at(-1).filter).toMatchObject({ algorithm: "baseline", phase: "random", preferenceRank: 2 });
  });

  it("supports rank sorting (ascending and descending) with a stable tiebreak", async () => {
    await get(url("?sort=rank"));
    expect(allocFinds.at(-1).q.sortArg).toMatchObject({ preferenceRank: 1 });
    expect(Object.keys(allocFinds.at(-1).q.sortArg)).toContain("_id");
    await get(url("?sort=-rank"));
    expect(allocFinds.at(-1).q.sortArg.preferenceRank).toBe(-1);
  });

  it("filters by student id (upper-cased) and by course within the run's semester", async () => {
    knownStudent = { _id: "507f1f77bcf86cd799440aa1" };
    knownCourse = { _id: "507f1f77bcf86cd799440bb1" };
    await get(url("?studentId=s1&courseCode=C1"));
    expect(studentLookups.at(-1)).toEqual({ studentId: "S1" });
    expect(courseLookups.at(-1)).toEqual({ courseCode: "C1", semesterId: "SEM-1" });
    expect(allocFinds.at(-1).filter).toMatchObject({ student: knownStudent._id, course: knownCourse._id });
  });

  it("an unknown student or course returns an empty page without querying assignments", async () => {
    const res = await get(url("?studentId=NOPE"));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ total: 0, allocations: [] });
    expect(allocFinds).toHaveLength(0);
  });

  it("rejects bad filters", async () => {
    for (const q of ["?phase=other", "?rank=0", "?sort=random"]) {
      expect((await get(url(q))).status).toBe(400);
    }
  });
});
