/**
 * tests/integration/allocation.test.js
 * Integration tests for allocation endpoints.
 * Tests: comparison trigger, run retrieval, result pagination,
 * publication guard rails, role enforcement, failed run handling.
 *
 * UPDATED: publish endpoint now requires { algorithm: "optimized"|"baseline" }
 * in the request body. Tests verify per-algorithm publish semantics.
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

// ── User fixtures ────────────────────────────────────────────────────────────
const RUN_ID   = "507f1f77bcf86cd799440001";
const ADMIN_ID = "507f1f77bcf86cd799440002";

const adminUser = { _id: ADMIN_ID, email: "admin@test.com", role: "admin", isActive: true };
const facultyUser = { _id: "507f1f77bcf86cd799440003", email: "faculty@test.com", role: "faculty", isActive: true };
const studentUser = {
  _id: "507f1f77bcf86cd799440004",
  email: "student@test.com",
  role: "student",
  student: "507f1f77bcf86cd799440005",
  isActive: true,
};

const mockUserFindById = vi.fn();
vi.mock("../../src/models/User.js", () => ({
  default: {
    findById: () => ({ select: () => ({ lean: mockUserFindById }) }),
    findOne: vi.fn(),
    exists: vi.fn(),
    create: vi.fn(),
  },
}));

// ── Mock the allocation service to avoid real DB + algorithm calls ────────────
const mockExecuteComparison  = vi.fn();
const mockListRuns           = vi.fn();
const mockGetRunById         = vi.fn();
const mockGetRunResults      = vi.fn();
const mockPublishRun         = vi.fn();

vi.mock("../../src/services/allocation.service.js", () => ({
  executeAllocationComparison: mockExecuteComparison,
  listAllocationRuns:          mockListRuns,
  getAllocationRunById:         mockGetRunById,
  getRunResults:               mockGetRunResults,
  publishAllocationRun:        mockPublishRun,
}));

function makeToken(user) {
  return jwt.sign(
    { sub: user._id, role: user.role },
    "test-secret-long-enough-for-tests-only",
    { expiresIn: "15m" }
  );
}

// Representative completed run document
const completedRun = {
  _id: RUN_ID,
  semesterId: "SEM2026A",
  status: "completed",
  configuration: { maxCoursesPerStudent: 2, meritRatio: 0.75, randomRatio: 0.25 },
  baselineMetrics: { totalAssignments: 8, constraintViolations: 0, averagePreferenceRank: 1.25 },
  optimizedMetrics: { totalAssignments: 8, constraintViolations: 0, averagePreferenceRank: 1.0 },
  baselineValidation: { valid: true, errorCount: 0, errorList: [] },
  optimizedValidation: { valid: true, errorCount: 0, errorList: [] },
  comparison: { improvement: {}, validComparison: true, note: "test" },
  baselineRuntimeMs: 5,
  optimizedRuntimeMs: 12,
  totalRuntimeMs: 20,
  inputSnapshot: { studentCount: 4, courseCount: 3, preferenceCount: 8, timetableIncluded: true },
  createdBy: { _id: ADMIN_ID, email: "admin@test.com", role: "admin" },
  publishedBy: null,
  publishedAt: null,
  selectedAlgorithm: null,
};

let app;

beforeAll(async () => {
  const mod = await import("../../src/app.js");
  app = mod.default;
});

// ── POST /api/v1/allocations/compare ────────────────────────────────────────
describe("POST /api/v1/allocations/compare", () => {
  const validBody = {
    semesterId: "SEM2026A",
    maxCoursesPerStudent: 2,
    meritRatio: 0.75,
    randomRatio: 0.25,
  };

  beforeEach(() => {
    mockUserFindById.mockResolvedValue(adminUser);
    mockExecuteComparison.mockResolvedValue(completedRun);
  });

  it("returns 401 without token", async () => {
    const res = await request(app).post("/api/v1/allocations/compare").send(validBody);
    expect(res.status).toBe(401);
  });

  it("returns 403 for student role", async () => {
    mockUserFindById.mockResolvedValue(studentUser);
    const token = makeToken(studentUser);
    const res = await request(app)
      .post("/api/v1/allocations/compare")
      .set("Cookie", `token=${token}`)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 for faculty role", async () => {
    mockUserFindById.mockResolvedValue(facultyUser);
    const token = makeToken(facultyUser);
    const res = await request(app)
      .post("/api/v1/allocations/compare")
      .set("Cookie", `token=${token}`)
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it("returns 201 for valid admin request", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .post("/api/v1/allocations/compare")
      .set("Cookie", `token=${token}`)
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.run._id).toBe(RUN_ID);
    expect(mockExecuteComparison).toHaveBeenCalledOnce();
  });

  it("applies defaults when optional fields are omitted", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .post("/api/v1/allocations/compare")
      .set("Cookie", `token=${token}`)
      .send({ semesterId: "SEM2026A" });
    expect(res.status).toBe(201);
    // Verify the service was called with defaults
    const [callArgs] = mockExecuteComparison.mock.calls;
    expect(callArgs[0].maxCoursesPerStudent).toBe(2);
    expect(callArgs[0].meritRatio).toBe(0.75);
    expect(callArgs[0].randomRatio).toBe(0.25);
  });

  it("returns 400 for missing semesterId", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .post("/api/v1/allocations/compare")
      .set("Cookie", `token=${token}`)
      .send({ maxCoursesPerStudent: 2 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for meritRatio > 1", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .post("/api/v1/allocations/compare")
      .set("Cookie", `token=${token}`)
      .send({ ...validBody, meritRatio: 1.5 });
    expect(res.status).toBe(400);
  });

  it("returns 400 for maxCoursesPerStudent of 0", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .post("/api/v1/allocations/compare")
      .set("Cookie", `token=${token}`)
      .send({ ...validBody, maxCoursesPerStudent: 0 });
    expect(res.status).toBe(400);
  });

  it("returns 400 when meritRatio + randomRatio != 1", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .post("/api/v1/allocations/compare")
      .set("Cookie", `token=${token}`)
      .send({ semesterId: "SEM2026A", meritRatio: 0.9, randomRatio: 0.9 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("propagates service-level errors correctly (no students found)", async () => {
    const { ApiError } = await import("../../src/utils/ApiError.js");
    mockExecuteComparison.mockRejectedValue(
      ApiError.badRequest('No active students found for semester "SEM2026A".')
    );
    const token = makeToken(adminUser);
    const res = await request(app)
      .post("/api/v1/allocations/compare")
      .set("Cookie", `token=${token}`)
      .send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/students/i);
  });
});

// ── GET /api/v1/allocations/runs ─────────────────────────────────────────────
describe("GET /api/v1/allocations/runs", () => {
  beforeEach(() => {
    mockUserFindById.mockResolvedValue(adminUser);
    mockListRuns.mockResolvedValue({
      runs: [completedRun],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
  });

  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/v1/allocations/runs");
    expect(res.status).toBe(401);
  });

  it("returns 403 for student role", async () => {
    mockUserFindById.mockResolvedValue(studentUser);
    const token = makeToken(studentUser);
    const res = await request(app)
      .get("/api/v1/allocations/runs")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(403);
  });

  it("returns 200 with runs list for admin", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .get("/api/v1/allocations/runs")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.runs)).toBe(true);
    expect(res.body.data.total).toBe(1);
  });

  it("returns 200 with runs list for faculty", async () => {
    mockUserFindById.mockResolvedValue(facultyUser);
    const token = makeToken(facultyUser);
    const res = await request(app)
      .get("/api/v1/allocations/runs")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
  });

  it("accepts valid status filter", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .get("/api/v1/allocations/runs?status=completed")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
  });

  it("rejects invalid status filter", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .get("/api/v1/allocations/runs?status=unknown")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(400);
  });
});

// ── GET /api/v1/allocations/runs/:runId ──────────────────────────────────────
describe("GET /api/v1/allocations/runs/:runId", () => {
  beforeEach(() => {
    mockUserFindById.mockResolvedValue(adminUser);
    mockGetRunById.mockResolvedValue(completedRun);
  });

  it("returns 200 with run summary for admin", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .get(`/api/v1/allocations/runs/${RUN_ID}`)
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.run.status).toBe("completed");
    expect(res.body.data.run.semesterId).toBe("SEM2026A");
  });

  it("returns 404 when run does not exist", async () => {
    const { ApiError } = await import("../../src/utils/ApiError.js");
    mockGetRunById.mockRejectedValue(ApiError.notFound("Allocation run"));
    const token = makeToken(adminUser);
    const res = await request(app)
      .get("/api/v1/allocations/runs/507f1f77bcf86cd799449999")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

// ── GET /api/v1/allocations/runs/:runId/results ───────────────────────────────
describe("GET /api/v1/allocations/runs/:runId/results", () => {
  const sampleResults = {
    run: completedRun,
    allocations: [
      {
        _id: "507f1f77bcf86cd799441001",
        student: { studentId: "S001", name: "Aarav", cgpa: 9.5 },
        course: { courseCode: "CS301", title: "Data Structures" },
        algorithm: "optimized",
        preferenceRank: 1,
        status: "proposed",
      },
    ],
    total: 1,
    page: 1,
    limit: 100,
    totalPages: 1,
  };

  beforeEach(() => {
    mockUserFindById.mockResolvedValue(adminUser);
    mockGetRunResults.mockResolvedValue(sampleResults);
  });

  it("returns 200 with paginated assignments", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .get(`/api/v1/allocations/runs/${RUN_ID}/results`)
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.allocations)).toBe(true);
    expect(res.body.data.allocations[0].algorithm).toBe("optimized");
  });

  it("filters by algorithm=baseline", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .get(`/api/v1/allocations/runs/${RUN_ID}/results?algorithm=baseline`)
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
    expect(mockGetRunResults).toHaveBeenCalledWith(
      RUN_ID,
      expect.objectContaining({ algorithm: "baseline" })
    );
  });

  it("rejects invalid algorithm filter", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .get(`/api/v1/allocations/runs/${RUN_ID}/results?algorithm=random`)
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(400);
  });
});

// ── POST /api/v1/allocations/runs/:runId/publish ─────────────────────────────
describe("POST /api/v1/allocations/runs/:runId/publish", () => {
  const publishedRunOptimized = {
    ...completedRun,
    status: "published",
    selectedAlgorithm: "optimized",
    publishedBy: { _id: ADMIN_ID, email: "admin@test.com" },
    publishedAt: new Date().toISOString(),
  };
  const publishedRunBaseline = {
    ...completedRun,
    status: "published",
    selectedAlgorithm: "baseline",
    publishedBy: { _id: ADMIN_ID, email: "admin@test.com" },
    publishedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    mockUserFindById.mockResolvedValue(adminUser);
    mockPublishRun.mockResolvedValue(publishedRunOptimized);
  });

  it("returns 400 when algorithm is missing from body", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .post(`/api/v1/allocations/runs/${RUN_ID}/publish`)
      .set("Cookie", `token=${token}`)
      .send({}); // no algorithm
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when algorithm is invalid", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .post(`/api/v1/allocations/runs/${RUN_ID}/publish`)
      .set("Cookie", `token=${token}`)
      .send({ algorithm: "random" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 200 for valid admin publish of optimized results", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .post(`/api/v1/allocations/runs/${RUN_ID}/publish`)
      .set("Cookie", `token=${token}`)
      .send({ algorithm: "optimized" });
    expect(res.status).toBe(200);
    expect(res.body.data.run.status).toBe("published");
    expect(res.body.data.run.selectedAlgorithm).toBe("optimized");
    // Verify service was called with the correct three arguments
    expect(mockPublishRun).toHaveBeenCalledWith(RUN_ID, adminUser._id.toString(), "optimized");
  });

  it("returns 200 for valid admin publish of baseline results", async () => {
    mockPublishRun.mockResolvedValue(publishedRunBaseline);
    const token = makeToken(adminUser);
    const res = await request(app)
      .post(`/api/v1/allocations/runs/${RUN_ID}/publish`)
      .set("Cookie", `token=${token}`)
      .send({ algorithm: "baseline" });
    expect(res.status).toBe(200);
    expect(res.body.data.run.selectedAlgorithm).toBe("baseline");
    expect(mockPublishRun).toHaveBeenCalledWith(RUN_ID, adminUser._id.toString(), "baseline");
  });

  it("returns 403 for faculty role (publish is admin-only)", async () => {
    mockUserFindById.mockResolvedValue(facultyUser);
    const token = makeToken(facultyUser);
    const res = await request(app)
      .post(`/api/v1/allocations/runs/${RUN_ID}/publish`)
      .set("Cookie", `token=${token}`)
      .send({ algorithm: "optimized" });
    expect(res.status).toBe(403);
  });

  it("returns 403 for student role", async () => {
    mockUserFindById.mockResolvedValue(studentUser);
    const token = makeToken(studentUser);
    const res = await request(app)
      .post(`/api/v1/allocations/runs/${RUN_ID}/publish`)
      .set("Cookie", `token=${token}`)
      .send({ algorithm: "optimized" });
    expect(res.status).toBe(403);
  });

  it("rejects publishing a failed run (service-level guard)", async () => {
    const { ApiError } = await import("../../src/utils/ApiError.js");
    mockPublishRun.mockRejectedValue(
      ApiError.badRequest('Only completed runs can be published. Current status: "failed".')
    );
    const token = makeToken(adminUser);
    const res = await request(app)
      .post(`/api/v1/allocations/runs/${RUN_ID}/publish`)
      .set("Cookie", `token=${token}`)
      .send({ algorithm: "optimized" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/completed/i);
  });

  it("idempotent: re-publishing same algorithm returns 200", async () => {
    // Service returns current state without error (idempotent)
    mockPublishRun.mockResolvedValue(publishedRunOptimized);
    const token = makeToken(adminUser);
    const res = await request(app)
      .post(`/api/v1/allocations/runs/${RUN_ID}/publish`)
      .set("Cookie", `token=${token}`)
      .send({ algorithm: "optimized" });
    expect(res.status).toBe(200);
    expect(res.body.data.run.status).toBe("published");
  });

  it("rejects switching algorithm after run is already published", async () => {
    const { ApiError } = await import("../../src/utils/ApiError.js");
    mockPublishRun.mockRejectedValue(
      ApiError.conflict(
        'This run is already published using the "optimized" algorithm. ' +
          "Create a new run to publish the other algorithm's results."
      )
    );
    const token = makeToken(adminUser);
    const res = await request(app)
      .post(`/api/v1/allocations/runs/${RUN_ID}/publish`)
      .set("Cookie", `token=${token}`)
      .send({ algorithm: "baseline" }); // switching after optimized published
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("rejects publishing a run with constraint violations (service-level guard)", async () => {
    const { ApiError } = await import("../../src/utils/ApiError.js");
    mockPublishRun.mockRejectedValue(
      ApiError.badRequest(
        'Cannot publish the "optimized" results: 2 constraint violation(s) found.'
      )
    );
    const token = makeToken(adminUser);
    const res = await request(app)
      .post(`/api/v1/allocations/runs/${RUN_ID}/publish`)
      .set("Cookie", `token=${token}`)
      .send({ algorithm: "optimized" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/constraint violation/i);
  });

  it("optimized-publish does not affect baseline: verify algorithm param isolation", async () => {
    const token = makeToken(adminUser);
    await request(app)
      .post(`/api/v1/allocations/runs/${RUN_ID}/publish`)
      .set("Cookie", `token=${token}`)
      .send({ algorithm: "optimized" });
    // Confirm service received "optimized", NOT "baseline"
    const lastCall = mockPublishRun.mock.calls.at(-1);
    expect(lastCall[2]).toBe("optimized");
    expect(lastCall[2]).not.toBe("baseline");
  });

  it("baseline-publish does not affect optimized: verify algorithm param isolation", async () => {
    mockPublishRun.mockResolvedValue(publishedRunBaseline);
    const token = makeToken(adminUser);
    await request(app)
      .post(`/api/v1/allocations/runs/${RUN_ID}/publish`)
      .set("Cookie", `token=${token}`)
      .send({ algorithm: "baseline" });
    const lastCall = mockPublishRun.mock.calls.at(-1);
    expect(lastCall[2]).toBe("baseline");
    expect(lastCall[2]).not.toBe("optimized");
  });
});


