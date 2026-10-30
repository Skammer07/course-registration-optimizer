/**
 * tests/integration/preferences.security.test.js
 * Regression tests for preference authorization, data exposure and
 * student/semester/group eligibility on submission.
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

const STUDENT_OBJ_ID = "507f1f77bcf86cd799430001";
const OTHER_STUDENT_ID = "507f1f77bcf86cd7994300ff";
const COURSE_1 = "507f1f77bcf86cd799430010";
const COURSE_2 = "507f1f77bcf86cd799430011";

const studentUser = {
  _id: "507f1f77bcf86cd799430003",
  email: "student@test.com",
  role: "student",
  student: STUDENT_OBJ_ID,
  isActive: true,
};
const adminUser = { _id: "507f1f77bcf86cd799430002", email: "admin@test.com", role: "admin", isActive: true };
const facultyUser = { _id: "507f1f77bcf86cd799430004", email: "fac@test.com", role: "faculty", isActive: true };

const mockUserFindById = vi.fn();
vi.mock("../../src/models/User.js", () => ({
  default: {
    findById: () => ({ select: () => ({ lean: mockUserFindById }) }),
    findOne: vi.fn(),
    exists: vi.fn(),
    create: vi.fn(),
  },
}));

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

const mockCourseFindLean = vi.fn();
vi.mock("../../src/models/Course.js", () => ({
  default: {
    find: vi.fn().mockReturnValue({ lean: mockCourseFindLean }),
    findById: vi.fn(),
    countDocuments: vi.fn().mockResolvedValue(0),
  },
}));

const mockPrefFind = vi.fn();
const mockPrefFindOneAndUpdate = vi.fn();
const mockPrefCountDocs = vi.fn().mockResolvedValue(0);
vi.mock("../../src/models/Preference.js", () => ({
  default: {
    find: mockPrefFind,
    findOneAndUpdate: mockPrefFindOneAndUpdate,
    findById: vi.fn(),
    countDocuments: mockPrefCountDocs,
  },
}));

const token = (user) =>
  jwt.sign({ sub: user._id, role: user.role }, "test-secret-long-enough-for-tests-only", {
    expiresIn: "15m",
  });

const course = (id, over = {}) => ({
  _id: id,
  courseCode: `C${id.slice(-2)}`,
  title: "T",
  semesterId: "SEM2026A",
  electiveGroup: "A",
  isActive: true,
  ...over,
});

const studentRecord = {
  _id: STUDENT_OBJ_ID,
  studentId: "20JE0001",
  semesterId: "SEM2026A",
  electiveGroups: ["A"],
  isActive: true,
};

let app;
beforeAll(async () => {
  app = (await import("../../src/app.js")).default;
});

const prefQuery = (rows = []) => ({
  populate: vi.fn().mockReturnThis(),
  sort: vi.fn().mockReturnThis(),
  skip: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  lean: vi.fn().mockResolvedValue(rows),
});

describe("GET /api/v1/preferences/me - authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrefFind.mockReturnValue(prefQuery([{ _id: "p1" }]));
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get("/api/v1/preferences/me");
    expect(res.status).toBe(401);
    expect(mockPrefFind).not.toHaveBeenCalled();
  });

  it("lets a student read their own preferences, filtered by their own id", async () => {
    mockUserFindById.mockResolvedValue(studentUser);
    const res = await request(app)
      .get("/api/v1/preferences/me")
      .set("Cookie", `token=${token(studentUser)}`);
    expect(res.status).toBe(200);
    expect(mockPrefFind).toHaveBeenCalledTimes(1);
    expect(String(mockPrefFind.mock.calls[0][0].student)).toBe(STUDENT_OBJ_ID);
  });

  it("ignores a student id supplied in the query string (cannot read another student's)", async () => {
    mockUserFindById.mockResolvedValue(studentUser);
    await request(app)
      .get(`/api/v1/preferences/me?student=${OTHER_STUDENT_ID}&studentId=${OTHER_STUDENT_ID}`)
      .set("Cookie", `token=${token(studentUser)}`);
    for (const [filter] of mockPrefFind.mock.calls) {
      expect(String(filter.student)).toBe(STUDENT_OBJ_ID);
    }
  });

  it.each([
    ["admin", adminUser],
    ["faculty", facultyUser],
  ])("%s without a linked student cannot use /me to list all preferences", async (_n, user) => {
    mockUserFindById.mockResolvedValue(user);
    const res = await request(app)
      .get("/api/v1/preferences/me")
      .set("Cookie", `token=${token(user)}`);
    expect(res.status).toBe(403);
    expect(mockPrefFind).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["malformed", "not-an-object-id"],
  ])("student account with %s student link never reaches an (unfiltered) query", async (_n, link) => {
    mockUserFindById.mockResolvedValue({ ...studentUser, student: link });
    const res = await request(app)
      .get("/api/v1/preferences/me")
      .set("Cookie", `token=${token(studentUser)}`);
    expect(res.status).toBe(400);
    expect(mockPrefFind).not.toHaveBeenCalled();
  });

  it("administrative listing still works for admin and faculty", async () => {
    mockPrefFind.mockReturnValue(prefQuery([{ _id: "p1" }, { _id: "p2" }]));
    for (const user of [adminUser, facultyUser]) {
      mockUserFindById.mockResolvedValue(user);
      const res = await request(app)
        .get("/api/v1/preferences")
        .set("Cookie", `token=${token(user)}`);
      expect(res.status).toBe(200);
      expect(res.body.data.preferences).toHaveLength(2);
    }
  });

  it("a student cannot use the administrative listing", async () => {
    mockUserFindById.mockResolvedValue(studentUser);
    const res = await request(app)
      .get("/api/v1/preferences")
      .set("Cookie", `token=${token(studentUser)}`);
    expect(res.status).toBe(403);
    expect(mockPrefFind).not.toHaveBeenCalled();
  });
});

describe("PUT /api/v1/preferences/me - ownership and eligibility", () => {
  const body = {
    semesterId: "SEM2026A",
    electiveGroup: "A",
    rankedCourseIds: [COURSE_1, COURSE_2],
    status: "submitted",
  };
  const put = (payload = body) =>
    request(app)
      .put("/api/v1/preferences/me")
      .set("Cookie", `token=${token(studentUser)}`)
      .send(payload);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUserFindById.mockResolvedValue(studentUser);
    mockStudentFindByIdLean.mockResolvedValue(studentRecord);
    mockCourseFindLean.mockResolvedValue([course(COURSE_1), course(COURSE_2)]);
    mockPrefFindOneAndUpdate.mockReturnValue({
      populate: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue({ _id: "p1" }),
    });
  });

  it("accepts a valid submission and writes only under the authenticated student", async () => {
    const res = await put({ ...body, student: OTHER_STUDENT_ID, studentId: "OTHER" });
    expect(res.status).toBe(200);
    const [filter, update] = mockPrefFindOneAndUpdate.mock.calls[0];
    expect(String(filter.student)).toBe(STUDENT_OBJ_ID);
    expect(JSON.stringify(update)).not.toContain(OTHER_STUDENT_ID);
  });

  it("rejects a semester the student is not registered for", async () => {
    const res = await put({ ...body, semesterId: "SEM2030Z" });
    expect(res.status).toBe(403);
    expect(mockPrefFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects when the student has no semester configured (fail closed)", async () => {
    mockStudentFindByIdLean.mockResolvedValue({ ...studentRecord, semesterId: "" });
    const res = await put();
    expect(res.status).toBe(403);
    expect(mockPrefFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects an inactive student record", async () => {
    mockStudentFindByIdLean.mockResolvedValue({ ...studentRecord, isActive: false });
    expect((await put()).status).toBe(403);
  });

  it("rejects courses from a different semester", async () => {
    mockCourseFindLean.mockResolvedValue([course(COURSE_1), course(COURSE_2, { semesterId: "SEM2025B" })]);
    const res = await put();
    expect(res.status).toBe(400);
    expect(mockPrefFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects courses that belong to a different elective group", async () => {
    mockCourseFindLean.mockResolvedValue([course(COURSE_1), course(COURSE_2, { electiveGroup: "B" })]);
    expect((await put()).status).toBe(400);
  });

  it("rejects non-elective (null group) courses", async () => {
    mockCourseFindLean.mockResolvedValue([course(COURSE_1), course(COURSE_2, { electiveGroup: null })]);
    expect((await put()).status).toBe(400);
  });

  it("rejects inactive courses", async () => {
    mockCourseFindLean.mockResolvedValue([course(COURSE_1), course(COURSE_2, { isActive: false })]);
    expect((await put()).status).toBe(400);
  });

  it("rejects nonexistent courses", async () => {
    mockCourseFindLean.mockResolvedValue([course(COURSE_1)]);
    expect((await put()).status).toBe(400);
  });

  it("rejects duplicate course selections", async () => {
    const res = await put({ ...body, rankedCourseIds: [COURSE_1, COURSE_1] });
    expect(res.status).toBe(400);
    expect(mockPrefFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects an electiveGroup the student is not enrolled in", async () => {
    mockStudentFindByIdLean.mockResolvedValue({ ...studentRecord, electiveGroups: ["B"] });
    expect((await put()).status).toBe(403);
  });

  it("rejects malformed course ids and an empty ranking", async () => {
    expect((await put({ ...body, rankedCourseIds: ["nope"] })).status).toBe(400);
    expect((await put({ ...body, rankedCourseIds: [] })).status).toBe(400);
  });

  it("a student account with no linked student record cannot submit", async () => {
    mockUserFindById.mockResolvedValue({ ...studentUser, student: undefined });
    const res = await put();
    expect(res.status).toBe(400);
    expect(mockPrefFindOneAndUpdate).not.toHaveBeenCalled();
  });
});
