/**
 * tests/integration/preferences.test.js
 * Integration tests for preference endpoints.
 * Tests: student access control, duplicate rejection, invalid course refs,
 * wrong semester/group, cross-student access prevention, status transitions.
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
const STUDENT_OBJ_ID = "507f1f77bcf86cd799430001";
const ADMIN_OBJ_ID   = "507f1f77bcf86cd799430002";
const COURSE_OID_1   = "507f1f77bcf86cd799430010";
const COURSE_OID_2   = "507f1f77bcf86cd799430011";
const PREF_OID       = "507f1f77bcf86cd799430020";

const studentUser = {
  _id: "507f1f77bcf86cd799430003",
  email: "student@test.com",
  role: "student",
  student: STUDENT_OBJ_ID,
  isActive: true,
};
const adminUser = {
  _id: ADMIN_OBJ_ID,
  email: "admin@test.com",
  role: "admin",
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

// ── Student model mock ───────────────────────────────────────────────────────
// Required because upsertPreference now loads the student for eligibility check.
const mockStudentFindByIdLean = vi.fn();
// Semester: no record => preferences open (default behaviour)
vi.mock("../../src/models/Semester.js", () => ({
  default: {
    findOne: () => ({ lean: async () => null }),
    updateOne: async () => ({}),
  },
}));

vi.mock("../../src/models/Student.js", () => ({
  default: {
    findById: vi.fn().mockReturnValue({ lean: mockStudentFindByIdLean }),
    find: vi.fn(),
    countDocuments: vi.fn().mockResolvedValue(0),
  },
}));

// ── Course model mock ────────────────────────────────────────────────────────
const mockCourseFindLean = vi.fn();
vi.mock("../../src/models/Course.js", () => ({
  default: {
    find: vi.fn().mockReturnValue({ lean: mockCourseFindLean }),
    findById: vi.fn(),
    countDocuments: vi.fn().mockResolvedValue(0),
  },
}));

// ── Preference model mock ────────────────────────────────────────────────────
const mockPrefFind           = vi.fn();
const mockPrefFindOneAndUpdate = vi.fn();
const mockPrefFindById       = vi.fn();
const mockPrefCountDocs      = vi.fn().mockResolvedValue(0);

vi.mock("../../src/models/Preference.js", () => ({
  default: {
    find: mockPrefFind,
    findOneAndUpdate: mockPrefFindOneAndUpdate,
    findById: mockPrefFindById,
    countDocuments: mockPrefCountDocs,
  },
}));

function makeToken(user) {
  return jwt.sign(
    { sub: user._id, role: user.role },
    "test-secret-long-enough-for-tests-only",
    { expiresIn: "15m" }
  );
}

// Simulated valid populated courses returned by Course.find
const validCourses = [
  {
    _id: COURSE_OID_1,
    courseCode: "CS301",
    title: "Data Structures",
    semesterId: "SEM2026A",
    electiveGroup: "A",
    isActive: true,
  },
  {
    _id: COURSE_OID_2,
    courseCode: "CS302",
    title: "Database Systems",
    semesterId: "SEM2026A",
    electiveGroup: "A",
    isActive: true,
  },
];

const savedPreference = {
  _id: PREF_OID,
  student: STUDENT_OBJ_ID,
  semesterId: "SEM2026A",
  electiveGroup: "A",
  rankedCourseIds: [
    { _id: COURSE_OID_1, courseCode: "CS301", title: "Data Structures" },
    { _id: COURSE_OID_2, courseCode: "CS302", title: "Database Systems" },
  ],
  status: "submitted",
  submittedAt: new Date().toISOString(),
};

let app;

beforeAll(async () => {
  const mod = await import("../../src/app.js");
  app = mod.default;
});

// ── GET /api/v1/preferences/me ───────────────────────────────────────────────
describe("GET /api/v1/preferences/me", () => {
  beforeEach(() => {
    mockUserFindById.mockResolvedValue(studentUser);
    mockPrefFind.mockReturnValue({
      populate: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([savedPreference]),
    });
  });

  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/v1/preferences/me");
    expect(res.status).toBe(401);
  });

  it("returns 200 for a student with their preferences", async () => {
    const token = makeToken(studentUser);
    const res = await request(app)
      .get("/api/v1/preferences/me")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.preferences)).toBe(true);
  });

  it("accepts optional semesterId and electiveGroup query params", async () => {
    const token = makeToken(studentUser);
    const res = await request(app)
      .get("/api/v1/preferences/me?semesterId=SEM2026A&electiveGroup=A")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
  });

  it("returns 400 when student user has no linked student record", async () => {
    mockUserFindById.mockResolvedValue({ ...studentUser, student: null });
    const token = makeToken(studentUser);
    const res = await request(app)
      .get("/api/v1/preferences/me")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });
});

// The student record returned by Student.findById during eligibility check.
// electiveGroups is empty array → eligibility check passes (see preference.service.js).
const studentRecord = {
  _id: STUDENT_OBJ_ID,
  studentId: "20JE0001",
  name: "Test Student",
  cgpa: 8.5,
  semesterId: "SEM2026A",
  electiveGroups: [], // empty → any group allowed (unresolved policy)
  isActive: true,
};

// ── PUT /api/v1/preferences/me ───────────────────────────────────────────────
describe("PUT /api/v1/preferences/me", () => {
  const validBody = {
    semesterId: "SEM2026A",
    electiveGroup: "A",
    rankedCourseIds: [COURSE_OID_1, COURSE_OID_2],
    status: "submitted",
  };

  beforeEach(() => {
    mockUserFindById.mockResolvedValue(studentUser);
    // Student eligibility check mock
    mockStudentFindByIdLean.mockResolvedValue(studentRecord);
    mockCourseFindLean.mockResolvedValue(validCourses);
    mockPrefFindOneAndUpdate.mockReturnValue({
      populate: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(savedPreference),
    });
  });

  it("returns 403 for admin role (only students can submit)", async () => {
    mockUserFindById.mockResolvedValue(adminUser);
    const token = makeToken(adminUser);
    const res = await request(app)
      .put("/api/v1/preferences/me")
      .set("Cookie", `token=${token}`)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 200 for student submitting valid preferences", async () => {
    const token = makeToken(studentUser);
    const res = await request(app)
      .put("/api/v1/preferences/me")
      .set("Cookie", `token=${token}`)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.preference).toBeDefined();
  });

  it("rejects duplicate course IDs in the ranked list", async () => {
    const token = makeToken(studentUser);
    const res = await request(app)
      .put("/api/v1/preferences/me")
      .set("Cookie", `token=${token}`)
      .send({ ...validBody, rankedCourseIds: [COURSE_OID_1, COURSE_OID_1] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).toMatch(/invalid/i);
  });

  it("rejects empty rankedCourseIds", async () => {
    const token = makeToken(studentUser);
    const res = await request(app)
      .put("/api/v1/preferences/me")
      .set("Cookie", `token=${token}`)
      .send({ ...validBody, rankedCourseIds: [] });
    expect(res.status).toBe(400);
  });

  it("rejects invalid ObjectId format in rankedCourseIds", async () => {
    const token = makeToken(studentUser);
    const res = await request(app)
      .put("/api/v1/preferences/me")
      .set("Cookie", `token=${token}`)
      .send({ ...validBody, rankedCourseIds: ["not-a-valid-id"] });
    expect(res.status).toBe(400);
  });

  it("rejects courses from a different semester (service-level check)", async () => {
    // Course.find returns courses with a different semesterId
    mockCourseFindLean.mockResolvedValue([
      { ...validCourses[0], semesterId: "SEM2025B" },
      { ...validCourses[1], semesterId: "SEM2025B" },
    ]);
    const token = makeToken(studentUser);
    const res = await request(app)
      .put("/api/v1/preferences/me")
      .set("Cookie", `token=${token}`)
      .send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/semester/i);
  });

  it("rejects courses from a different elective group", async () => {
    mockCourseFindLean.mockResolvedValue([
      { ...validCourses[0], electiveGroup: "B" },
      { ...validCourses[1], electiveGroup: "B" },
    ]);
    const token = makeToken(studentUser);
    const res = await request(app)
      .put("/api/v1/preferences/me")
      .set("Cookie", `token=${token}`)
      .send(validBody); // electiveGroup "A" but courses are "B"
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/elective group/i);
  });

  it("rejects inactive courses", async () => {
    mockCourseFindLean.mockResolvedValue([
      { ...validCourses[0], isActive: false },
      validCourses[1],
    ]);
    const token = makeToken(studentUser);
    const res = await request(app)
      .put("/api/v1/preferences/me")
      .set("Cookie", `token=${token}`)
      .send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not active/i);
  });

  it("rejects when not all courseIds exist in DB", async () => {
    // Only 1 course returned when 2 were requested
    mockCourseFindLean.mockResolvedValue([validCourses[0]]);
    const token = makeToken(studentUser);
    const res = await request(app)
      .put("/api/v1/preferences/me")
      .set("Cookie", `token=${token}`)
      .send(validBody);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/invalid/i);
  });

  it("rejects missing semesterId", async () => {
    const token = makeToken(studentUser);
    const { semesterId: _omit, ...rest } = validBody;
    const res = await request(app)
      .put("/api/v1/preferences/me")
      .set("Cookie", `token=${token}`)
      .send(rest);
    expect(res.status).toBe(400);
  });

  it("rejects submission for an elective group the student is not enrolled in", async () => {
    // Student only belongs to group "B", not "A"
    mockStudentFindByIdLean.mockResolvedValue({
      ...studentRecord,
      electiveGroups: ["B"],
    });
    const token = makeToken(studentUser);
    const res = await request(app)
      .put("/api/v1/preferences/me")
      .set("Cookie", `token=${token}`)
      .send(validBody); // electiveGroup "A" — not in ["B"]
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(res.body.error.message).toMatch(/not eligible/i);
  });

  it("allows submission when student has no electiveGroups configured (unresolved policy)", async () => {
    // Empty electiveGroups → all groups are accessible (documented assumption)
    mockStudentFindByIdLean.mockResolvedValue({
      ...studentRecord,
      electiveGroups: [],
    });
    const token = makeToken(studentUser);
    const res = await request(app)
      .put("/api/v1/preferences/me")
      .set("Cookie", `token=${token}`)
      .send(validBody);
    expect(res.status).toBe(200);
  });
});

// ── GET /api/v1/preferences (admin) ─────────────────────────────────────────
describe("GET /api/v1/preferences", () => {
  beforeEach(() => {
    mockUserFindById.mockResolvedValue(adminUser);
    mockPrefFind.mockReturnValue({
      populate: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([savedPreference]),
    });
    mockPrefCountDocs.mockResolvedValue(1);
  });

  it("returns 200 with all preferences for admin", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .get("/api/v1/preferences")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.preferences)).toBe(true);
  });

  it("returns 403 for student role trying to list all preferences", async () => {
    mockUserFindById.mockResolvedValue(studentUser);
    const token = makeToken(studentUser);
    const res = await request(app)
      .get("/api/v1/preferences")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("filters by status=submitted correctly", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .get("/api/v1/preferences?status=submitted")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
  });

  it("rejects invalid status filter", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .get("/api/v1/preferences?status=approved")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(400);
  });
});

// ── GET /api/v1/preferences/:id (admin) ─────────────────────────────────────
describe("GET /api/v1/preferences/:id", () => {
  beforeEach(() => {
    mockUserFindById.mockResolvedValue(adminUser);
    mockPrefFindById.mockReturnValue({
      populate: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(savedPreference),
    });
  });

  it("returns 200 for a valid preference ID for admin", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .get(`/api/v1/preferences/${PREF_OID}`)
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.preference.status).toBe("submitted");
  });

  it("returns 404 for a missing preference", async () => {
    mockPrefFindById.mockReturnValue({
      populate: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(null),
    });
    const token = makeToken(adminUser);
    const res = await request(app)
      .get("/api/v1/preferences/507f1f77bcf86cd799430099")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(404);
  });

  it("returns 403 for student accessing admin preference listing", async () => {
    mockUserFindById.mockResolvedValue(studentUser);
    const token = makeToken(studentUser);
    const res = await request(app)
      .get(`/api/v1/preferences/${PREF_OID}`)
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(403);
  });
});
