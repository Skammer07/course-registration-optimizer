/**
 * tests/integration/observability.test.js
 * Request ids, the health check, and stale-run housekeeping.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";

vi.mock("../../src/config/env.js", () => ({
  env: {
    port: 5000, nodeEnv: "test", mongoUri: "mongodb://test",
    jwtSecret: "test-secret-long-enough-for-tests-only", jwtExpiresIn: "15m",
    clientOrigin: "http://localhost:5173", rateLimitLoginMax: 100, rateLimitLoginWindowMs: 900000,
    seedAdminEmail: "", seedAdminPassword: "", isDevelopment: false, isTest: true, isProduction: false,
  },
}));

let dbStatus = "connected";
vi.mock("../../src/config/db.js", () => ({
  connectDB: vi.fn().mockResolvedValue(undefined),
  disconnectDB: vi.fn().mockResolvedValue(undefined),
  getDbStatus: () => dbStatus,
}));

vi.mock("../../src/models/User.js", () => ({
  default: { findById: vi.fn(), findOne: vi.fn(), exists: vi.fn(), create: vi.fn() },
}));

// ---- run model fakes for the maintenance sweep ---------------------------------
const sweep = { staleRuns: [], findFilter: null, deleted: [], updated: [] };
vi.mock("../../src/models/AllocationRun.js", () => ({
  default: {
    find: (filter) => {
      sweep.findFilter = filter;
      return { select: () => ({ lean: async () => sweep.staleRuns }) };
    },
    updateMany: async (filter, update) => {
      sweep.updated.push({ filter, update });
      return { modifiedCount: sweep.staleRuns.length };
    },
  },
}));
vi.mock("../../src/models/Allocation.js", () => ({
  default: { deleteMany: async (f) => { sweep.deleted.push(f); return {}; } },
}));

let app;
let advisories;
let maintenance;
beforeAll(async () => {
  app = (await import("../../src/app.js")).default;
  advisories = await import("../../src/utils/runAdvisories.js");
  maintenance = await import("../../src/services/runMaintenance.service.js");
});

beforeEach(() => {
  dbStatus = "connected";
  sweep.staleRuns = [];
  sweep.findFilter = null;
  sweep.deleted.length = 0;
  sweep.updated.length = 0;
  delete process.env.ALLOCATION_TIMEOUT_MS;
});

describe("request ids", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  it("every response carries an X-Request-Id (a fresh UUID by default)", async () => {
    const a = await request(app).get("/health");
    const b = await request(app).get("/health");
    expect(a.headers["x-request-id"]).toMatch(UUID);
    expect(a.headers["x-request-id"]).not.toBe(b.headers["x-request-id"]);
  });

  it("reuses a safe client-supplied id and replaces an unsafe one", async () => {
    const ok = await request(app).get("/health").set("X-Request-Id", "frontend-req_42.a");
    expect(ok.headers["x-request-id"]).toBe("frontend-req_42.a");
    for (const bad of ["x".repeat(65), "has space", "semi;colon", "<script>"]) {
      const res = await request(app).get("/health").set("X-Request-Id", bad);
      expect(res.headers["x-request-id"]).toMatch(UUID);
    }
  });

  it("error bodies include the same requestId so a user can quote it", async () => {
    const res = await request(app).get("/api/v1/nope").set("X-Request-Id", "trace-me-1");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.requestId).toBe("trace-me-1");
    expect(res.headers["x-request-id"]).toBe("trace-me-1");

    const unauth = await request(app).get("/api/v1/students");
    expect(unauth.status).toBe(401);
    expect(unauth.body.requestId).toBe(unauth.headers["x-request-id"]);
  });

  it("success bodies are left untouched", async () => {
    const res = await request(app).get("/health");
    expect(res.body).not.toHaveProperty("requestId");
  });

  it("the header is exposed to browsers (CORS)", async () => {
    const res = await request(app).get("/health").set("Origin", "http://localhost:5173");
    expect(res.headers["access-control-expose-headers"]).toMatch(/X-Request-Id/i);
  });
});

describe("GET /health", () => {
  it("reports database, algorithm, version, uptime and active runs", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      status: "ok",
      services: { database: "connected", algorithm: "available" },
      activeRuns: 0,
    });
    expect(res.body.algorithmVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof res.body.uptimeSeconds).toBe("number");
    expect(JSON.stringify(res.body)).not.toMatch(/mongodb|secret|password/i);
  });

  it("is 503 degraded when the database is down", async () => {
    dbStatus = "disconnected";
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ success: false, status: "degraded", services: { database: "disconnected" } });
  });
});

describe("largeTimetableRunWarning", () => {
  const w = (...args) => advisories.largeTimetableRunWarning(...args);
  it("only advises for big runs that include the optimizer with the timetable on", () => {
    expect(w({ studentCount: 150, includeTimetable: true, includesOptimizer: true })).toMatch(/150 students/);
    expect(w({ studentCount: 1000, includeTimetable: true, includesOptimizer: true })).toMatch(/includeTimetable=false/);
    expect(w({ studentCount: 149, includeTimetable: true, includesOptimizer: true })).toBeNull();
    expect(w({ studentCount: 500, includeTimetable: false, includesOptimizer: true })).toBeNull();
    expect(w({ studentCount: 500, includeTimetable: true, includesOptimizer: false })).toBeNull();
    expect(w({ studentCount: undefined, includeTimetable: true, includesOptimizer: true })).toBeNull();
  });
});

describe("stale-run sweep", () => {
  const NOW = Date.UTC(2026, 5, 1, 12, 0, 0);

  it("the cutoff is twice the allocation time limit plus a minute", () => {
    expect(+maintenance.staleRunCutoff(NOW)).toBe(NOW - (2 * 60_000 + 60_000));
    process.env.ALLOCATION_TIMEOUT_MS = "10000";
    expect(+maintenance.staleRunCutoff(NOW)).toBe(NOW - (2 * 10_000 + 60_000));
  });

  it("does nothing when no run is stale", async () => {
    expect(await maintenance.failStaleRuns(NOW)).toEqual({ failed: 0 });
    expect(sweep.deleted).toHaveLength(0);
    expect(sweep.updated).toHaveLength(0);
  });

  it("only looks at old RUNNING runs, removes their assignments and marks them failed", async () => {
    sweep.staleRuns = [{ _id: "r1" }, { _id: "r2" }];
    const res = await maintenance.failStaleRuns(NOW);
    expect(res).toEqual({ failed: 2 });
    expect(sweep.findFilter.status).toBe("running");
    expect(+sweep.findFilter.createdAt.$lt).toBe(+maintenance.staleRunCutoff(NOW));
    expect(sweep.deleted[0]).toEqual({ run: { $in: ["r1", "r2"] } });
    const upd = sweep.updated[0];
    expect(upd.filter).toEqual({ _id: { $in: ["r1", "r2"] }, status: "running" }); // never overwrites a run that just finished
    expect(upd.update.$set).toMatchObject({ status: "failed" });
    expect(upd.update.$set.errorSummary).toMatch(/server restart or crash/);
  });
});

describe("startRunSweeper", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sweeps immediately, then on every interval, until stopped", async () => {
    const stop = maintenance.startRunSweeper({ intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    const afterStart = sweep.updated.length + (sweep.findFilter ? 1 : 0);
    expect(afterStart).toBeGreaterThan(0); // the immediate sweep queried the database
    sweep.findFilter = null;
    await vi.advanceTimersByTimeAsync(1000);
    expect(sweep.findFilter).not.toBeNull(); // the interval fired
    stop();
    sweep.findFilter = null;
    await vi.advanceTimersByTimeAsync(5000);
    expect(sweep.findFilter).toBeNull(); // stopped
  });
});
