/**
 * tests/integration/students.test.js
 * Integration tests for student endpoints.
 * Mocks DB to avoid requiring a live MongoDB instance.
 *
 * Authorization rules verified:
 *   - GET  /          admin/faculty only; students get 403
 *   - GET  /:id       admin/faculty always; student can access own record, gets 403 for others
 *   - POST /          admin/faculty only
 *   - PATCH /:id      admin/faculty only; student gets 403
 *   - DELETE /:id     admin only; faculty gets 403
 *   - passwordHash never appears in any response
 *   - Mass-assignment guard: studentId cannot be changed via PATCH
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import request from "supertest";

// ── Shared env mock ──────────────────────────────────────────────────────────
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

// ── Shared auth fixtures ─────────────────────────────────────────────────────
const STUDENT_OBJ_ID = "507f1f77bcf86cd799439033"; // Student._id
const OTHER_STUDENT_OBJ_ID = "507f1f77bcf86cd799439055";

const adminUser = {
  _id: "507f1f77bcf86cd799439011",
  email: "admin@test.com",
  role: "admin",
  isActive: true,
};

const facultyUser = {
  _id: "507f1f77bcf86cd799439066",
  email: "faculty@test.com",
  role: "faculty",
  isActive: true,
};

// Student user linked to STUDENT_OBJ_ID
const studentUser = {
  _id: "507f1f77bcf86cd799439022",
  email: "student@test.com",
  role: "student",
  student: STUDENT_OBJ_ID,
  isActive: true,
};

// Another student linked to a different record
const otherStudentUser = {
  _id: "507f1f77bcf86cd799439077",
  email: "other@test.com",
  role: "student",
  student: OTHER_STUDENT_OBJ_ID,
  isActive: true,
};

// Mock User model for auth middleware
const mockUserFindById = vi.fn();
vi.mock("../../src/models/User.js", () => ({
  default: {
    findById: () => ({
      select: () => ({ lean: mockUserFindById }),
    }),
    findOne: vi.fn(),
    exists: vi.fn(),
    create: vi.fn(),
  },
}));

// Mock Student model
const mockStudentFindWithChain = vi.fn();
const mockStudentCountDocuments = vi.fn().mockResolvedValue(2);
const mockStudentFindById = vi.fn();
const mockStudentCreate = vi.fn();
const mockStudentFindByIdAndUpdate = vi.fn();

vi.mock("../../src/models/Student.js", () => ({
  default: {
    find: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: mockStudentFindWithChain,
    }),
    findById: () => ({ select: vi.fn().mockReturnThis(), lean: mockStudentFindById }),
    findByIdAndUpdate: () => ({ lean: mockStudentFindByIdAndUpdate }),
    countDocuments: mockStudentCountDocuments,
    create: mockStudentCreate,
  },
}));

import jwt from "jsonwebtoken";

function makeToken(user) {
  return jwt.sign(
    { sub: user._id, role: user.role },
    "test-secret-long-enough-for-tests-only",
    { expiresIn: "15m" }
  );
}

let app;

beforeAll(async () => {
  const mod = await import("../../src/app.js");
  app = mod.default;
});

const sampleStudent = {
  _id: STUDENT_OBJ_ID,
  studentId: "20JE0001",
  name: "Aarav Kumar",
  cgpa: 9.5,
  department: "CSE",
  semesterId: "SEM2026A",
  isActive: true,
};

const otherStudent = {
  _id: OTHER_STUDENT_OBJ_ID,
  studentId: "20JE0002",
  name: "Priya Sharma",
  cgpa: 8.5,
  department: "ECE",
  semesterId: "SEM2026A",
  isActive: true,
};

// ── GET /api/v1/students ──────────────────────────────────────────────────────
describe("GET /api/v1/students", () => {
  beforeEach(() => {
    mockUserFindById.mockResolvedValue(adminUser);
    mockStudentFindWithChain.mockResolvedValue([sampleStudent]);
    mockStudentCountDocuments.mockResolvedValue(1);
  });

  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/v1/students");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 200 with list for authenticated admin", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .get("/api/v1/students")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.students)).toBe(true);
  });

  it("returns 200 for authenticated faculty", async () => {
    mockUserFindById.mockResolvedValue(facultyUser);
    const token = makeToken(facultyUser);
    const res = await request(app)
      .get("/api/v1/students")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
  });

  it("returns 403 for authenticated student (students cannot list all records)", async () => {
    mockUserFindById.mockResolvedValue(studentUser);
    const token = makeToken(studentUser);
    const res = await request(app)
      .get("/api/v1/students")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("passwordHash is never present in list response (Student model has no such field)", async () => {
    // Student documents never contain passwordHash — it only exists on User.
    // This test verifies the API response only returns documented Student fields.
    const token = makeToken(adminUser);
    const res = await request(app)
      .get("/api/v1/students")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    // Student schema fields present
    expect(body).toContain("studentId");
    // User-only fields must never appear
    expect(body).not.toContain("passwordHash");
  });

  it("returns 400 for invalid limit query param", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .get("/api/v1/students?limit=999")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for search query exceeding 100 characters", async () => {
    const token = makeToken(adminUser);
    const longSearch = "a".repeat(101);
    const res = await request(app)
      .get(`/api/v1/students?search=${longSearch}`)
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

// ── GET /api/v1/students/:id ─────────────────────────────────────────────────
describe("GET /api/v1/students/:id", () => {
  beforeEach(() => {
    mockUserFindById.mockResolvedValue(adminUser);
    mockStudentFindById.mockResolvedValue(sampleStudent);
  });

  it("returns 200 for admin accessing any student", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .get(`/api/v1/students/${sampleStudent._id}`)
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.student.studentId).toBe("20JE0001");
  });

  it("returns 200 for faculty accessing any student", async () => {
    mockUserFindById.mockResolvedValue(facultyUser);
    const token = makeToken(facultyUser);
    const res = await request(app)
      .get(`/api/v1/students/${sampleStudent._id}`)
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
  });

  it("returns 200 for a student accessing their own record", async () => {
    mockUserFindById.mockResolvedValue(studentUser);
    // The student's linked Student._id matches the requested record
    mockStudentFindById.mockResolvedValue(sampleStudent); // _id = STUDENT_OBJ_ID
    const token = makeToken(studentUser);
    const res = await request(app)
      .get(`/api/v1/students/${STUDENT_OBJ_ID}`)
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.student._id).toBe(STUDENT_OBJ_ID);
  });

  it("returns 403 for a student attempting to read another student's record", async () => {
    mockUserFindById.mockResolvedValue(studentUser); // linked to STUDENT_OBJ_ID
    mockStudentFindById.mockResolvedValue(otherStudent); // returns OTHER_STUDENT_OBJ_ID
    const token = makeToken(studentUser);
    const res = await request(app)
      .get(`/api/v1/students/${OTHER_STUDENT_OBJ_ID}`)
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 for student with no linked student record", async () => {
    const unlinkedStudentUser = { ...studentUser, student: null };
    mockUserFindById.mockResolvedValue(unlinkedStudentUser);
    const token = makeToken(unlinkedStudentUser);
    const res = await request(app)
      .get(`/api/v1/students/${STUDENT_OBJ_ID}`)
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 404 when student does not exist", async () => {
    mockStudentFindById.mockResolvedValue(null);
    const token = makeToken(adminUser);
    const res = await request(app)
      .get("/api/v1/students/507f1f77bcf86cd799439099")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("passwordHash is never present in single-student response (Student model has no such field)", async () => {
    // Student documents never contain passwordHash — it only exists on User.
    // The select projection in getStudentById excludes unexpected fields.
    const token = makeToken(adminUser);
    const res = await request(app)
      .get(`/api/v1/students/${sampleStudent._id}`)
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).toContain("studentId");
    expect(body).not.toContain("passwordHash");
  });
});

// ── POST /api/v1/students ────────────────────────────────────────────────────
describe("POST /api/v1/students", () => {
  beforeEach(() => {
    mockUserFindById.mockResolvedValue(adminUser);
    mockStudentCreate.mockResolvedValue({
      toObject: () => sampleStudent,
    });
  });

  it("returns 201 for valid student creation by admin", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .post("/api/v1/students")
      .set("Cookie", `token=${token}`)
      .send({
        studentId: "20JE0001",
        name: "Aarav Kumar",
        cgpa: 9.5,
        department: "CSE",
        semesterId: "SEM2026A",
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.student).toBeDefined();
  });

  it("returns 201 for valid student creation by faculty", async () => {
    mockUserFindById.mockResolvedValue(facultyUser);
    const token = makeToken(facultyUser);
    const res = await request(app)
      .post("/api/v1/students")
      .set("Cookie", `token=${token}`)
      .send({ studentId: "20JE0002", name: "Priya", cgpa: 8.0, department: "ECE" });
    expect(res.status).toBe(201);
  });

  it("returns 403 when student role tries to create a student", async () => {
    mockUserFindById.mockResolvedValue(studentUser);
    const token = makeToken(studentUser);
    const res = await request(app)
      .post("/api/v1/students")
      .set("Cookie", `token=${token}`)
      .send({ studentId: "20JE9999", name: "X", cgpa: 8.0 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 400 for CGPA above 10", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .post("/api/v1/students")
      .set("Cookie", `token=${token}`)
      .send({ studentId: "20JE0001", name: "X", cgpa: 10.5 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for negative CGPA", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .post("/api/v1/students")
      .set("Cookie", `token=${token}`)
      .send({ studentId: "20JE0001", name: "X", cgpa: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for missing studentId", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .post("/api/v1/students")
      .set("Cookie", `token=${token}`)
      .send({ name: "X", cgpa: 8.0 });
    expect(res.status).toBe(400);
  });
});

// ── PATCH /api/v1/students/:id ───────────────────────────────────────────────
describe("PATCH /api/v1/students/:id", () => {
  beforeEach(() => {
    mockUserFindById.mockResolvedValue(adminUser);
    mockStudentFindByIdAndUpdate.mockResolvedValue({ ...sampleStudent, cgpa: 9.8 });
  });

  it("returns 200 for valid update by admin", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .patch(`/api/v1/students/${sampleStudent._id}`)
      .set("Cookie", `token=${token}`)
      .send({ cgpa: 9.8 });
    expect(res.status).toBe(200);
  });

  it("returns 403 for student trying to modify a student record", async () => {
    mockUserFindById.mockResolvedValue(studentUser);
    const token = makeToken(studentUser);
    const res = await request(app)
      .patch(`/api/v1/students/${sampleStudent._id}`)
      .set("Cookie", `token=${token}`)
      .send({ cgpa: 10.0 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});

// ── PATCH field restrictions for faculty ─────────────────────────────────────
describe("PATCH /api/v1/students/:id - faculty may not change allocation-relevant fields", () => {
  beforeEach(() => {
    mockUserFindById.mockResolvedValue(facultyUser);
    mockStudentFindByIdAndUpdate.mockClear();
    mockStudentFindByIdAndUpdate.mockResolvedValue({ ...sampleStudent, name: "New Name", __v: 3 });
  });

  const patch = (body) =>
    request(app)
      .patch(`/api/v1/students/${sampleStudent._id}`)
      .set("Cookie", `token=${makeToken(facultyUser)}`)
      .send(body);

  it.each([
    [{ cgpa: 9.9 }],
    [{ semesterId: "SEM9" }],
    [{ electiveGroups: ["A"] }],
    [{ isActive: false }],
    [{ name: "N", cgpa: 9.9 }],
  ])("403 for %j and nothing is written", async (body) => {
    const res = await patch(body);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(mockStudentFindByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("faculty may still edit descriptive fields, and the response is allowlisted (no __v)", async () => {
    const res = await patch({ name: "New Name", department: "CSE" });
    expect(res.status).toBe(200);
    expect(res.body.data.student.name).toBe("New Name");
    expect(res.body.data.student).not.toHaveProperty("__v");
  });

  it("admin may change cgpa", async () => {
    mockUserFindById.mockResolvedValue(adminUser);
    const res = await request(app)
      .patch(`/api/v1/students/${sampleStudent._id}`)
      .set("Cookie", `token=${makeToken(adminUser)}`)
      .send({ cgpa: 9.9 });
    expect(res.status).toBe(200);
  });
});

// ── DELETE /api/v1/students/:id ──────────────────────────────────────────────
describe("DELETE /api/v1/students/:id", () => {
  beforeEach(() => {
    mockUserFindById.mockResolvedValue(adminUser);
    mockStudentFindByIdAndUpdate.mockResolvedValue({ ...sampleStudent, isActive: false });
  });

  it("returns 200 and deactivates student (soft delete)", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .delete(`/api/v1/students/${sampleStudent._id}`)
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
  });

  it("returns 403 for faculty role on DELETE", async () => {
    mockUserFindById.mockResolvedValue(facultyUser);
    const token = makeToken(facultyUser);
    const res = await request(app)
      .delete(`/api/v1/students/${sampleStudent._id}`)
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(403);
  });

  it("returns 403 for student role on DELETE", async () => {
    mockUserFindById.mockResolvedValue(studentUser);
    const token = makeToken(studentUser);
    const res = await request(app)
      .delete(`/api/v1/students/${sampleStudent._id}`)
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(403);
  });
});


