/**
 * tests/integration/semesters.test.js
 * Semester records, the preference window (deadlines), the status endpoint,
 * and enforcement when a student edits preferences.
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
const facultyUser = { _id: "507f1f77bcf86cd799440003", role: "faculty", isActive: true };
const studentUser = { _id: "507f1f77bcf86cd799440004", role: "student", student: STUDENT_OID, isActive: true };

const mockUserFindById = vi.fn();
vi.mock("../../src/models/User.js", () => ({
  default: {
    findById: () => ({ select: () => ({ lean: mockUserFindById }) }),
    findOne: vi.fn(), exists: vi.fn(), create: vi.fn(),
  },
}));

// ---- Semester model fake: one optional record --------------------------------
let semRecord = null;
const semWrites = [];
vi.mock("../../src/models/Semester.js", () => {
  const wrap = (f) => {
    if (!semRecord || (f?.semesterId && f.semesterId !== semRecord.semesterId)) return null;
    const doc = {
      ...semRecord,
      save: async () => {
        // Mongoose casts to Date before validation; mimic that.
        for (const k of ["preferencesOpenAt", "preferencesCloseAt"]) if (doc[k]) doc[k] = new Date(doc[k]);
        if (doc.preferencesOpenAt && doc.preferencesCloseAt && doc.preferencesCloseAt <= doc.preferencesOpenAt) {
          const e = new Error("preferencesCloseAt must be after preferencesOpenAt");
          e.name = "ValidationError";
          throw e;
        }
        semRecord = { ...semRecord, ...Object.fromEntries(Object.entries(doc).filter(([k]) => k !== "save" && k !== "toObject")) };
      },
      toObject: () => ({ ...semRecord }),
    };
    return doc;
  };
  const findOne = (f) =>
    Object.assign(Promise.resolve(wrap(f)), {
      lean: async () => (wrap(f) ? semRecord : null),
    });
  return {
    default: {
      findOne,
      find: () => ({ sort: () => ({ lean: async () => (semRecord ? [semRecord] : []) }) }),
      create: async (data) => {
        if (semRecord && semRecord.semesterId === data.semesterId) {
          const e = new Error("dup"); e.code = 11000; throw e;
        }
        semRecord = { preferencesOpenAt: null, preferencesCloseAt: null, preferencesOverride: null, name: "", ...data };
        return { toObject: () => ({ ...semRecord }) };
      },
      findOneAndUpdate: (_f, upd) => ({
        lean: async () => {
          semWrites.push(upd);
          semRecord = { semesterId: "SEM-1", ...(semRecord ?? {}), ...upd.$set };
          return semRecord;
        },
      }),
      updateOne: async (_f, upd) => {
        semWrites.push(upd);
        semRecord = { semesterId: "SEM-1", ...(semRecord ?? {}), ...upd.$set };
        return {};
      },
    },
  };
});

const mockStudentFindById = vi.fn();
vi.mock("../../src/models/Student.js", () => ({
  default: {
    findById: () => {
      const result = mockStudentFindById();
      return Object.assign(Promise.resolve(result), {
        select: () => ({ lean: async () => result }),
        lean: async () => result,
      });
    },
  },
}));

const mockRunFindOne = vi.fn();
vi.mock("../../src/models/AllocationRun.js", () => ({
  default: { findOne: () => ({ sort: () => ({ select: () => ({ lean: mockRunFindOne }) }) }) },
}));
vi.mock("../../src/models/Allocation.js", () => ({ default: { find: vi.fn() } }));
vi.mock("../../src/models/Course.js", () => ({ default: { find: vi.fn() } }));
vi.mock("../../src/models/Preference.js", () => ({ default: { findOneAndUpdate: vi.fn() } }));

let app;
let semesterService;
beforeAll(async () => {
  process.env.JWT_SECRET = "test-secret-long-enough-for-tests-only";
  app = (await import("../../src/app.js")).default;
  semesterService = await import("../../src/services/semester.service.js");
});

const cookie = (u) =>
  `token=${jwt.sign({ sub: u._id, role: u.role }, "test-secret-long-enough-for-tests-only", { expiresIn: "15m" })}`;

const HOUR = 3600 * 1000;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  semRecord = null;
  semWrites.length = 0;
  mockUserFindById.mockResolvedValue(adminUser);
  mockStudentFindById.mockReturnValue({ _id: STUDENT_OID, studentId: "S1", name: "Asha", semesterId: "SEM-1", isActive: true, electiveGroups: [] });
  mockRunFindOne.mockResolvedValue(null);
});

describe("computePreferenceWindow (pure)", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  const w = (s) => semesterService.computePreferenceWindow(s, now);

  it("no record means open", () => expect(w(null)).toMatchObject({ open: true, source: "default" }));
  it("no dates means open", () => expect(w({})).toMatchObject({ open: true }));
  it("before the open date is not-open", () =>
    expect(w({ preferencesOpenAt: "2026-07-01T00:00:00Z" })).toMatchObject({ open: false, phase: "not-open" }));
  it("inside the window is open", () =>
    expect(w({ preferencesOpenAt: "2026-06-01T00:00:00Z", preferencesCloseAt: "2026-07-01T00:00:00Z" })).toMatchObject({ open: true }));
  it("at/after the close date is closed", () => {
    expect(w({ preferencesCloseAt: "2026-06-15T12:00:00Z" })).toMatchObject({ open: false, phase: "closed" });
    expect(w({ preferencesCloseAt: "2026-06-01T00:00:00Z" })).toMatchObject({ open: false, phase: "closed" });
  });
  it("override beats the dates in both directions", () => {
    expect(w({ preferencesOverride: "open", preferencesCloseAt: "2026-06-01T00:00:00Z" }).open).toBe(true);
    expect(w({ preferencesOverride: "closed", preferencesOpenAt: "2026-06-01T00:00:00Z" }).open).toBe(false);
  });
});

describe("enforcement when a student edits preferences", () => {
  const data = { semesterId: "SEM-1", electiveGroup: "A", rankedCourseIds: ["507f1f77bcf86cd799440aaa"], status: "draft" };

  it("is rejected with PREFERENCES_CLOSED after the close date (before any course lookup)", async () => {
    semRecord = { semesterId: "SEM-1", preferencesCloseAt: iso(-HOUR) };
    const { upsertPreference } = await import("../../src/services/preference.service.js");
    await expect(upsertPreference(STUDENT_OID, data)).rejects.toMatchObject({ statusCode: 403, code: "PREFERENCES_CLOSED" });
  });

  it("is rejected before the window opens", async () => {
    semRecord = { semesterId: "SEM-1", preferencesOpenAt: iso(HOUR) };
    const { upsertPreference } = await import("../../src/services/preference.service.js");
    await expect(upsertPreference(STUDENT_OID, data)).rejects.toMatchObject({ code: "PREFERENCES_CLOSED" });
  });

  it("is rejected when the admin closed it manually", async () => {
    semRecord = { semesterId: "SEM-1", preferencesOverride: "closed" };
    const { upsertPreference } = await import("../../src/services/preference.service.js");
    await expect(upsertPreference(STUDENT_OID, data)).rejects.toMatchObject({ code: "PREFERENCES_CLOSED" });
  });

  it("passes the deadline check inside the window (then fails later on the mocked course lookup)", async () => {
    semRecord = { semesterId: "SEM-1", preferencesOpenAt: iso(-HOUR), preferencesCloseAt: iso(HOUR) };
    const { upsertPreference } = await import("../../src/services/preference.service.js");
    const err = await upsertPreference(STUDENT_OID, data).catch((e) => e);
    expect(err?.code).not.toBe("PREFERENCES_CLOSED");
  });

  it("a semester with no record stays open", async () => {
    const { upsertPreference } = await import("../../src/services/preference.service.js");
    const err = await upsertPreference(STUDENT_OID, data).catch((e) => e);
    expect(err?.code).not.toBe("PREFERENCES_CLOSED");
  });
});

describe("semester admin endpoints", () => {
  it("require login and admin for writes", async () => {
    expect((await request(app).post("/api/v1/semesters").send({ semesterId: "S" })).status).toBe(401);
    mockUserFindById.mockResolvedValue(facultyUser);
    expect((await request(app).post("/api/v1/semesters").set("Cookie", cookie(facultyUser)).send({ semesterId: "S" })).status).toBe(403);
    mockUserFindById.mockResolvedValue(studentUser);
    expect((await request(app).get("/api/v1/semesters").set("Cookie", cookie(studentUser))).status).toBe(403);
  });

  it("admin creates a semester; duplicate gives 409", async () => {
    const body = { semesterId: "SEM-1", name: "Autumn", preferencesOpenAt: iso(-HOUR), preferencesCloseAt: iso(HOUR) };
    const a = await request(app).post("/api/v1/semesters").set("Cookie", cookie(adminUser)).send(body);
    expect(a.status).toBe(201);
    expect(a.body.data.semester.semesterId).toBe("SEM-1");
    const b = await request(app).post("/api/v1/semesters").set("Cookie", cookie(adminUser)).send(body);
    expect(b.status).toBe(409);
  });

  it("rejects close <= open, unknown fields and an empty id", async () => {
    const bad = [
      { semesterId: "S", preferencesOpenAt: iso(HOUR), preferencesCloseAt: iso(-HOUR) },
      { semesterId: "S", preferencesOverride: "closed" },
      { semesterId: "  " },
    ];
    for (const b of bad) {
      expect((await request(app).post("/api/v1/semesters").set("Cookie", cookie(adminUser)).send(b)).status).toBe(400);
    }
  });

  it("PATCH updates dates and validates the window against the stored record", async () => {
    semRecord = { semesterId: "SEM-1", preferencesOpenAt: iso(-HOUR), preferencesCloseAt: iso(HOUR) };
    const ok = await request(app).patch("/api/v1/semesters/SEM-1").set("Cookie", cookie(adminUser)).send({ name: "Renamed" });
    expect(ok.status).toBe(200);
    expect(ok.body.data.semester.name).toBe("Renamed");
    const bad = await request(app).patch("/api/v1/semesters/SEM-1").set("Cookie", cookie(adminUser)).send({ preferencesCloseAt: iso(-2 * HOUR) });
    expect(bad.status).toBe(400);
    expect((await request(app).patch("/api/v1/semesters/NOPE").set("Cookie", cookie(adminUser)).send({ name: "x" }))).toMatchObject({ status: 404 });
    expect((await request(app).patch("/api/v1/semesters/SEM-1").set("Cookie", cookie(adminUser)).send({})).status).toBe(400);
  });

  it("PUT preferences-state validates the value and sets the override (auto clears it)", async () => {
    const put = (state) => request(app).put("/api/v1/semesters/SEM-1/preferences-state").set("Cookie", cookie(adminUser)).send({ state });
    expect((await put("sideways")).status).toBe(400);
    expect((await put("closed")).body.data.semester.preferencesOverride).toBe("closed");
    expect((await put("auto")).body.data.semester.preferencesOverride).toBeNull();
  });
});

describe("GET /semesters/:semesterId/status", () => {
  it("requires login", async () => {
    expect((await request(app).get("/api/v1/semesters/SEM-1/status")).status).toBe(401);
  });

  it("no record: preferences-open", async () => {
    const res = await request(app).get("/api/v1/semesters/SEM-1/status").set("Cookie", cookie(adminUser));
    expect(res.body.data).toMatchObject({ status: "preferences-open", preferencesOpen: true, recordExists: false });
  });

  it("before the window: preferences-not-open", async () => {
    semRecord = { semesterId: "SEM-1", preferencesOpenAt: iso(HOUR) };
    const res = await request(app).get("/api/v1/semesters/SEM-1/status").set("Cookie", cookie(adminUser));
    expect(res.body.data.status).toBe("preferences-not-open");
  });

  it("after the window with nothing published: allocation-pending", async () => {
    semRecord = { semesterId: "SEM-1", preferencesCloseAt: iso(-HOUR) };
    const res = await request(app).get("/api/v1/semesters/SEM-1/status").set("Cookie", cookie(adminUser));
    expect(res.body.data).toMatchObject({ status: "allocation-pending", preferencesOpen: false });
  });

  it("a published run wins: results-published", async () => {
    semRecord = { semesterId: "SEM-1", preferencesOverride: "closed" };
    mockRunFindOne.mockResolvedValue({ _id: "r1", semesterId: "SEM-1", selectedAlgorithm: "optimized", publishedAt: new Date() });
    const res = await request(app).get("/api/v1/semesters/SEM-1/status").set("Cookie", cookie(adminUser));
    expect(res.body.data).toMatchObject({ status: "results-published", resultsPublished: true });
    expect(res.body.data.publishedRun.algorithm).toBe("optimized");
  });

  it("student: 'me' resolves to their own semester; another semester is 403", async () => {
    mockUserFindById.mockResolvedValue(studentUser);
    const me = await request(app).get("/api/v1/semesters/me/status").set("Cookie", cookie(studentUser));
    expect(me.status).toBe(200);
    expect(me.body.data.semesterId).toBe("SEM-1");
    const other = await request(app).get("/api/v1/semesters/OTHER/status").set("Cookie", cookie(studentUser));
    expect(other.status).toBe(403);
  });

  it("admin using 'me' gets 400", async () => {
    const res = await request(app).get("/api/v1/semesters/me/status").set("Cookie", cookie(adminUser));
    expect(res.status).toBe(400);
  });
});

describe("closePreferencesAfterPublish", () => {
  it("sets the override to closed (and creates the record if missing)", async () => {
    await semesterService.closePreferencesAfterPublish("SEM-1");
    expect(semRecord.preferencesOverride).toBe("closed");
  });
});

describe("preferenceWindowWarning", () => {
  it("warns only when a record exists and preferences are still open", async () => {
    expect(await semesterService.preferenceWindowWarning("SEM-1")).toBeNull();
    semRecord = { semesterId: "SEM-1", preferencesCloseAt: iso(HOUR) };
    expect(await semesterService.preferenceWindowWarning("SEM-1")).toMatch(/still open/);
    semRecord = { semesterId: "SEM-1", preferencesCloseAt: iso(-HOUR) };
    expect(await semesterService.preferenceWindowWarning("SEM-1")).toBeNull();
  });
});
