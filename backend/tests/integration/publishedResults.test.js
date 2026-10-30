/**
 * tests/integration/publishedResults.test.js
 * GET /allocations/my-results and GET /allocations/published:
 * a student sees only their OWN PUBLISHED assignments.
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

const STUDENT_OID = "507f1f77bcf86cd799440005";
const adminUser = { _id: "507f1f77bcf86cd799440002", role: "admin", isActive: true };
const studentUser = { _id: "507f1f77bcf86cd799440004", role: "student", student: STUDENT_OID, isActive: true };
const unlinkedStudent = { _id: "507f1f77bcf86cd799440006", role: "student", isActive: true };

const mockUserFindById = vi.fn();
vi.mock("../../src/models/User.js", () => ({
  default: {
    findById: () => ({ select: () => ({ lean: mockUserFindById }) }),
    findOne: vi.fn(), exists: vi.fn(), create: vi.fn(),
  },
}));

const mockStudentFindById = vi.fn();
vi.mock("../../src/models/Student.js", () => ({
  default: { findById: () => ({ select: () => ({ lean: mockStudentFindById }) }) },
}));

const mockRunFindOne = vi.fn();
const runFindOneArgs = [];
vi.mock("../../src/models/AllocationRun.js", () => ({
  default: {
    findOne: (filter) => {
      runFindOneArgs.push(filter);
      return { sort: () => ({ select: () => ({ lean: mockRunFindOne }) }) };
    },
  },
}));

const mockAllocFind = vi.fn();
vi.mock("../../src/models/Allocation.js", () => ({
  default: { find: (filter) => ({ populate: () => ({ sort: () => ({ lean: () => mockAllocFind(filter) }) }) }) },
}));

let app;
beforeAll(async () => {
  process.env.JWT_SECRET = "test-secret-long-enough-for-tests-only";
  app = (await import("../../src/app.js")).default;
});

const cookie = (u) =>
  `token=${jwt.sign({ sub: u._id, role: u.role }, "test-secret-long-enough-for-tests-only", { expiresIn: "15m" })}`;

const publishedRun = {
  _id: "507f1f77bcf86cd799440010", semesterId: "SEM-1", selectedAlgorithm: "baseline",
  publishedAt: new Date("2026-01-01T00:00:00Z"), configuration: { maxCoursesPerStudent: 2 },
};

beforeEach(() => {
  vi.clearAllMocks();
  runFindOneArgs.length = 0;
  mockUserFindById.mockResolvedValue(studentUser);
  mockStudentFindById.mockResolvedValue({ _id: STUDENT_OID, studentId: "S1", name: "Asha", semesterId: "SEM-1" });
});

describe("GET /allocations/my-results", () => {
  it("requires login", async () => {
    expect((await request(app).get("/api/v1/allocations/my-results")).status).toBe(401);
  });

  it("is student-only (admin gets 403)", async () => {
    mockUserFindById.mockResolvedValue(adminUser);
    const res = await request(app).get("/api/v1/allocations/my-results").set("Cookie", cookie(adminUser));
    expect(res.status).toBe(403);
  });

  it("rejects a student account with no linked student record", async () => {
    mockUserFindById.mockResolvedValue(unlinkedStudent);
    const res = await request(app).get("/api/v1/allocations/my-results").set("Cookie", cookie(unlinkedStudent));
    expect(res.status).toBe(400);
  });

  it("returns published:false with empty assignments when nothing is published", async () => {
    mockRunFindOne.mockResolvedValue(null);
    const res = await request(app).get("/api/v1/allocations/my-results").set("Cookie", cookie(studentUser));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ published: false, run: null, assignments: [] });
    expect(mockAllocFind).not.toHaveBeenCalled();
  });

  it("looks only at PUBLISHED runs of the student's own semester", async () => {
    mockRunFindOne.mockResolvedValue(null);
    await request(app).get("/api/v1/allocations/my-results?semesterId=OTHER").set("Cookie", cookie(studentUser));
    expect(runFindOneArgs[0]).toEqual({ semesterId: "SEM-1", status: "published" });
  });

  it("returns only the student's own published rows of the selected algorithm", async () => {
    mockRunFindOne.mockResolvedValue(publishedRun);
    mockAllocFind.mockResolvedValue([
      { course: { courseCode: "C1", title: "Algo", electiveGroup: "A" }, preferenceRank: 1, phase: "merit" },
      { course: { courseCode: "C2", title: "ML", electiveGroup: "B" }, preferenceRank: 3, phase: "random" },
    ]);
    const res = await request(app).get("/api/v1/allocations/my-results").set("Cookie", cookie(studentUser));
    expect(res.status).toBe(200);
    expect(mockAllocFind).toHaveBeenCalledWith({
      run: publishedRun._id, student: STUDENT_OID, algorithm: "baseline", status: "published",
    });
    expect(res.body.data.assignments).toHaveLength(2);
    expect(res.body.data.assignments[0]).toEqual({
      course: { courseCode: "C1", title: "Algo", electiveGroup: "A" }, preferenceRank: 1, phase: "merit",
    });
    expect(res.body.data.run.algorithm).toBe("baseline");
    expect(res.body.data.summary).toMatchObject({ coursesAllocated: 2, maxCoursesPerStudent: 2 });
    expect(JSON.stringify(res.body)).not.toMatch(/cgpa/i);
  });

  it("gives a clear message when the student got no course", async () => {
    mockRunFindOne.mockResolvedValue(publishedRun);
    mockAllocFind.mockResolvedValue([]);
    const res = await request(app).get("/api/v1/allocations/my-results").set("Cookie", cookie(studentUser));
    expect(res.body.data.published).toBe(true);
    expect(res.body.data.assignments).toEqual([]);
    expect(res.body.data.summary.message).toMatch(/No course/);
  });
});

describe("GET /allocations/published", () => {
  it("requires login", async () => {
    expect((await request(app).get("/api/v1/allocations/published?semesterId=SEM-1")).status).toBe(401);
  });

  it("admin must pass semesterId", async () => {
    mockUserFindById.mockResolvedValue(adminUser);
    const res = await request(app).get("/api/v1/allocations/published").set("Cookie", cookie(adminUser));
    expect(res.status).toBe(400);
  });

  it("admin gets the published run info (no metrics or snapshot)", async () => {
    mockUserFindById.mockResolvedValue(adminUser);
    mockRunFindOne.mockResolvedValue(publishedRun);
    const res = await request(app).get("/api/v1/allocations/published?semesterId=SEM-1").set("Cookie", cookie(adminUser));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ published: true, run: { algorithm: "baseline", semesterId: "SEM-1" } });
    expect(res.body.data.run).not.toHaveProperty("inputSnapshot");
  });

  it("student defaults to their own semester", async () => {
    mockRunFindOne.mockResolvedValue(publishedRun);
    mockAllocFind.mockResolvedValue([]);
    const res = await request(app).get("/api/v1/allocations/published").set("Cookie", cookie(studentUser));
    expect(res.status).toBe(200);
    expect(res.body.data.semesterId).toBe("SEM-1");
  });

  it("student cannot query another semester", async () => {
    const res = await request(app).get("/api/v1/allocations/published?semesterId=OTHER").set("Cookie", cookie(studentUser));
    expect(res.status).toBe(403);
  });
});
