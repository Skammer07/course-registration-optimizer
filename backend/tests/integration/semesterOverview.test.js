/**
 * tests/integration/semesterOverview.test.js
 * GET /semesters/overview: every semester that has data or a record, with counts, so a screen
 * can offer a list instead of asking for a typed id.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

vi.mock("../../src/config/env.js", () => ({
  env: {
    port: 5000, nodeEnv: "test", mongoUri: "mongodb://test",
    jwtSecret: "test-secret-long-enough-for-tests-only", jwtExpiresIn: "15m",
    clientOrigin: "http://localhost:5173", rateLimitLoginMax: 100, rateLimitLoginWindowMs: 900000,
    seedAdminEmail: "", seedAdminPassword: "", isDevelopment: false, isTest: true, isProduction: false,
  },
}));
vi.mock("../../src/config/db.js", () => ({
  connectDB: vi.fn().mockResolvedValue(undefined),
  disconnectDB: vi.fn().mockResolvedValue(undefined),
  getDbStatus: vi.fn().mockReturnValue("connected"),
}));

const SECRET = "test-secret-long-enough-for-tests-only";
const ADMIN = { _id: "507f1f77bcf86cd799440002", role: "admin", isActive: true };
const FACULTY = { _id: "507f1f77bcf86cd799440003", role: "faculty", isActive: true };
const STUDENT = { _id: "507f1f77bcf86cd799440004", role: "student", student: "507f1f77bcf86cd799440005", isActive: true };
let authUser = ADMIN;

vi.mock("../../src/models/User.js", () => ({
  default: { findById: () => ({ select: () => ({ lean: async () => authUser }) }), findOne: vi.fn(), exists: vi.fn(), create: vi.fn() },
}));

// what each aggregation returns, and the pipelines it was asked to run
const data = { students: [], courses: [], preferences: [], runs: [], records: [] };
const pipelines = {};
const aggregate = (key) => async (pipeline) => {
  pipelines[key] = pipeline;
  return data[key];
};
vi.mock("../../src/models/Student.js", () => ({ default: { aggregate: (p) => aggregate("students")(p), findById: vi.fn() } }));
vi.mock("../../src/models/Course.js", () => ({ default: { aggregate: (p) => aggregate("courses")(p), find: vi.fn() } }));
vi.mock("../../src/models/Preference.js", () => ({ default: { aggregate: (p) => aggregate("preferences")(p) } }));
vi.mock("../../src/models/AllocationRun.js", () => ({
  default: { aggregate: (p) => aggregate("runs")(p), findOne: () => ({ sort: () => ({ select: () => ({ lean: async () => null }) }) }) },
}));
vi.mock("../../src/models/Semester.js", () => ({
  default: { find: () => ({ select: () => ({ lean: async () => data.records }) }), findOne: vi.fn() },
}));

let app;
beforeAll(async () => {
  app = (await import("../../src/app.js")).default;
});
const get = (user = ADMIN) => {
  authUser = user;
  return request(app).get("/api/v1/semesters/overview").set("Cookie", `token=${jwt.sign({ sub: user._id, role: user.role }, SECRET, { expiresIn: "15m" })}`);
};

beforeEach(() => {
  authUser = ADMIN;
  for (const k of Object.keys(data)) data[k] = [];
  for (const k of Object.keys(pipelines)) delete pipelines[k];
});

describe("GET /semesters/overview", () => {
  it("needs a login and the admin or faculty role (it exposes counts of students and runs)", async () => {
    expect((await request(app).get("/api/v1/semesters/overview")).status).toBe(401);
    expect((await get(STUDENT)).status).toBe(403);
    expect((await get(FACULTY)).status).toBe(200);
    expect((await get(ADMIN)).status).toBe(200);
  });

  it("an empty system is an empty list, not an error", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.data.semesters).toEqual([]);
  });

  it("seeded or imported data with no admin record still shows up, with its counts", async () => {
    data.students = [{ _id: "SEM-DEMO", n: 30 }];
    data.courses = [{ _id: "SEM-DEMO", n: 8 }];
    data.preferences = [{ _id: "SEM-DEMO", n: 60 }];
    const res = await get();
    expect(res.body.data.semesters).toEqual([
      { semesterId: "SEM-DEMO", name: "", recordExists: false, students: 30, courses: 8, preferenceLists: 60, runs: 0, published: false },
    ]);
  });

  it("merges students, courses, preferences, runs and records for the same semester", async () => {
    data.students = [{ _id: "SEM-A", n: 30 }];
    data.courses = [{ _id: "SEM-A", n: 8 }];
    data.preferences = [{ _id: "SEM-A", n: 60 }];
    data.runs = [{ _id: "SEM-A", n: 3, published: 1 }];
    data.records = [{ semesterId: "SEM-A", name: "Autumn" }];
    const [a] = (await get()).body.data.semesters;
    expect(a).toEqual({ semesterId: "SEM-A", name: "Autumn", recordExists: true, students: 30, courses: 8, preferenceLists: 60, runs: 3, published: true });
  });

  it("published is false when a semester has runs but none is published", async () => {
    data.students = [{ _id: "SEM-A", n: 5 }];
    data.runs = [{ _id: "SEM-A", n: 2, published: 0 }];
    expect((await get()).body.data.semesters[0]).toMatchObject({ runs: 2, published: false });
  });

  it("lists semesters that hold data first, then by id; a record alone still appears", async () => {
    data.students = [{ _id: "SEM-Z", n: 10 }, { _id: "SEM-B", n: 20 }];
    data.records = [{ semesterId: "SEM-A", name: "Planned" }];
    data.runs = [{ _id: "SEM-OLD", n: 1, published: 0 }];
    const ids = (await get()).body.data.semesters.map((s) => s.semesterId);
    expect(ids).toEqual(["SEM-B", "SEM-Z", "SEM-A", "SEM-OLD"]);
  });

  it("ignores blank or missing semester ids (students entered without one)", async () => {
    data.students = [{ _id: "", n: 4 }, { _id: null, n: 2 }, { _id: "  ", n: 1 }, { _id: "SEM-A", n: 3 }];
    const ids = (await get()).body.data.semesters.map((s) => s.semesterId);
    expect(ids).toEqual(["SEM-A"]);
  });

  it("counts only what a run would use: active students and courses, submitted preferences", async () => {
    await get();
    expect(pipelines.students[0]).toEqual({ $match: { isActive: true } });
    expect(pipelines.courses[0]).toEqual({ $match: { isActive: true } });
    expect(pipelines.preferences[0]).toEqual({ $match: { status: "submitted" } });
    for (const key of ["students", "courses", "preferences"]) {
      expect(pipelines[key][1]).toEqual({ $group: { _id: "$semesterId", n: { $sum: 1 } } });
    }
  });
});
