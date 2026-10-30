/**
 * tests/integration/singleRun.routes.test.js
 * HTTP layer for POST /allocations/run and GET /allocations/runs/compare:
 * authentication, roles, request validation, and route ordering.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

vi.mock("../../src/config/env.js", () => ({
  env: {
    port: 5000,
    nodeEnv: "test",
    mongoUri: "mongodb://test",
    jwtSecret: "test-secret-long-enough-for-tests-only",
    jwtExpiresIn: "15m",
    clientOrigin: "http://localhost:5173",
    rateLimitLoginMax: 100,
    rateLimitLoginWindowMs: 900000,
    seedAdminEmail: "",
    seedAdminPassword: "",
    isDevelopment: false,
    isTest: true,
    isProduction: false,
  },
}));

vi.mock("../../src/config/db.js", () => ({
  connectDB: vi.fn().mockResolvedValue(undefined),
  disconnectDB: vi.fn().mockResolvedValue(undefined),
  getDbStatus: vi.fn().mockReturnValue("connected"),
}));

const adminUser = { _id: "507f1f77bcf86cd799440002", email: "a@t.com", role: "admin", isActive: true };
const facultyUser = { _id: "507f1f77bcf86cd799440003", email: "f@t.com", role: "faculty", isActive: true };
const studentUser = {
  _id: "507f1f77bcf86cd799440004", email: "s@t.com", role: "student",
  student: "507f1f77bcf86cd799440005", isActive: true,
};

const mockUserFindById = vi.fn();
vi.mock("../../src/models/User.js", () => ({
  default: {
    findById: () => ({ select: () => ({ lean: mockUserFindById }) }),
    findOne: vi.fn(), exists: vi.fn(), create: vi.fn(),
  },
}));

const mockSingle = vi.fn();
const mockCompare = vi.fn();
const mockGetRun = vi.fn();
vi.mock("../../src/services/allocation.service.js", () => ({
  executeAllocationComparison: vi.fn(),
  executeSingleAllocation: mockSingle,
  compareRuns: mockCompare,
  listAllocationRuns: vi.fn(),
  getAllocationRunById: mockGetRun,
  getRunResults: vi.fn(),
  publishAllocationRun: vi.fn(),
}));

const token = (u) =>
  jwt.sign({ sub: u._id, role: u.role }, "test-secret-long-enough-for-tests-only", { expiresIn: "15m" });
const RUN_A = "507f1f77bcf86cd799440011";
const RUN_B = "507f1f77bcf86cd799440012";

let app;
beforeAll(async () => {
  app = (await import("../../src/app.js")).default;
});
beforeEach(() => {
  vi.clearAllMocks();
  mockUserFindById.mockResolvedValue(adminUser);
  mockSingle.mockResolvedValue({ _id: RUN_A, status: "completed", algorithmsRun: ["baseline"] });
  mockCompare.mockResolvedValue({ difference: {}, warnings: [] });
});

const post = (body, u = adminUser) =>
  request(app).post("/api/v1/allocations/run").set("Cookie", `token=${token(u)}`).send(body);

describe("POST /api/v1/allocations/run", () => {
  it("401 without a token", async () => {
    const res = await request(app).post("/api/v1/allocations/run").send({ semesterId: "S", algorithm: "baseline" });
    expect(res.status).toBe(401);
  });

  it.each([["faculty", facultyUser], ["student", studentUser]])("403 for %s", async (_n, u) => {
    mockUserFindById.mockResolvedValue(u);
    const res = await post({ semesterId: "S", algorithm: "baseline" }, u);
    expect(res.status).toBe(403);
    expect(mockSingle).not.toHaveBeenCalled();
  });

  it.each(["baseline", "optimized"])("201 for admin running only %s", async (algorithm) => {
    const res = await post({ semesterId: "SEM1", algorithm });
    expect(res.status).toBe(201);
    expect(mockSingle).toHaveBeenCalledWith(
      expect.objectContaining({ semesterId: "SEM1", algorithm, maxCoursesPerStudent: 2, createdByUserId: adminUser._id })
    );
  });

  it("accepts baseline meritRatio 0 / randomRatio 1 and a seed", async () => {
    const res = await post({ semesterId: "S", algorithm: "baseline", meritRatio: 0, randomRatio: 1, seed: 9 });
    expect(res.status).toBe(201);
  });

  it.each([
    ["missing algorithm", { semesterId: "S" }],
    ["unknown algorithm", { semesterId: "S", algorithm: "both" }],
    ["missing semesterId", { algorithm: "baseline" }],
    ["ratios not summing to 1", { semesterId: "S", algorithm: "baseline", meritRatio: 0.5, randomRatio: 0.4 }],
    ["negative ratio", { semesterId: "S", algorithm: "baseline", meritRatio: -0.1, randomRatio: 1.1 }],
    ["ratio on optimized", { semesterId: "S", algorithm: "optimized", meritRatio: 0.5, randomRatio: 0.5 }],
    ["seed on optimized", { semesterId: "S", algorithm: "optimized", seed: 1 }],
    ["fractional seed", { semesterId: "S", algorithm: "baseline", seed: 1.5 }],
    ["maxCoursesPerStudent 0", { semesterId: "S", algorithm: "baseline", maxCoursesPerStudent: 0 }],
  ])("400 for %s", async (_n, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(mockSingle).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/allocations/runs/compare", () => {
  const get = (qs, u = adminUser) =>
    request(app).get(`/api/v1/allocations/runs/compare${qs}`).set("Cookie", `token=${token(u)}`);

  it("401 without a token", async () => {
    expect((await request(app).get(`/api/v1/allocations/runs/compare?runA=${RUN_A}&runB=${RUN_B}`)).status).toBe(401);
  });

  it("403 for a student", async () => {
    mockUserFindById.mockResolvedValue(studentUser);
    expect((await get(`?runA=${RUN_A}&runB=${RUN_B}`, studentUser)).status).toBe(403);
  });

  it("200 for admin and faculty, routed to compareRuns and not to /runs/:runId", async () => {
    for (const u of [adminUser, facultyUser]) {
      mockUserFindById.mockResolvedValue(u);
      const res = await get(`?runA=${RUN_A}&runB=${RUN_B}&algorithmB=optimized`, u);
      expect(res.status).toBe(200);
    }
    expect(mockCompare).toHaveBeenCalledWith(
      expect.objectContaining({ runA: RUN_A, runB: RUN_B, algorithmB: "optimized" })
    );
    expect(mockGetRun).not.toHaveBeenCalled();
  });

  it.each([
    ["missing runB", `?runA=${RUN_A}`],
    ["malformed id", `?runA=nope&runB=${RUN_B}`],
    ["bad algorithm", `?runA=${RUN_A}&runB=${RUN_B}&algorithmA=both`],
  ])("400 for %s", async (_n, qs) => {
    expect((await get(qs)).status).toBe(400);
    expect(mockCompare).not.toHaveBeenCalled();
  });
});
