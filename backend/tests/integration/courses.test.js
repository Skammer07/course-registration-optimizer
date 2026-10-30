/**
 * tests/integration/courses.test.js
 * Integration tests for course endpoints.
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

const adminUser = {
  _id: "507f1f77bcf86cd799439011",
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

const mockCourseFindWithChain = vi.fn();
const mockCourseCountDocuments = vi.fn().mockResolvedValue(1);
const mockCourseFindById = vi.fn();
const mockCourseCreate = vi.fn();
const mockCourseFindByIdAndUpdate = vi.fn();

vi.mock("../../src/models/Course.js", () => ({
  default: {
    find: vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: mockCourseFindWithChain,
    }),
    findById: () => ({ lean: mockCourseFindById }),
    findByIdAndUpdate: () => ({ lean: mockCourseFindByIdAndUpdate }),
    countDocuments: mockCourseCountDocuments,
    create: mockCourseCreate,
  },
}));

const sampleCourse = {
  _id: "507f1f77bcf86cd799439055",
  courseCode: "CS301",
  title: "Data Structures",
  capacity: 60,
  semesterId: "SEM2026A",
  electiveGroup: "A",
  timetableSlots: [{ day: "Monday", start: "09:00", end: "09:50" }],
  isActive: true,
};

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

beforeEach(() => {
  mockUserFindById.mockResolvedValue(adminUser);
  mockCourseFindWithChain.mockResolvedValue([sampleCourse]);
  mockCourseCountDocuments.mockResolvedValue(1);
  mockCourseFindById.mockResolvedValue(sampleCourse);
  mockCourseCreate.mockResolvedValue({ toObject: () => sampleCourse });
  mockCourseFindByIdAndUpdate.mockResolvedValue(sampleCourse);
});

describe("GET /api/v1/courses", () => {
  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/v1/courses");
    expect(res.status).toBe(401);
  });

  it("returns 200 with courses list for admin", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .get("/api/v1/courses")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.courses)).toBe(true);
  });

  it("accepts valid query filters", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .get("/api/v1/courses?semesterId=SEM2026A&isActive=true&page=1&limit=10")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
  });

  it("returns 400 for invalid isActive value", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .get("/api/v1/courses?isActive=maybe")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/courses", () => {
  it("creates a course with 201 for admin", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .post("/api/v1/courses")
      .set("Cookie", `token=${token}`)
      .send({
        courseCode: "cs301",
        title: "Data Structures",
        capacity: 60,
        semesterId: "SEM2026A",
        electiveGroup: "A",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.course.courseCode).toBe("CS301"); // uppercased by mock
  });

  it("rejects negative capacity", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .post("/api/v1/courses")
      .set("Cookie", `token=${token}`)
      .send({ courseCode: "CS999", title: "X", capacity: -5, semesterId: "SEM2026A" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("accepts capacity of 0", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .post("/api/v1/courses")
      .set("Cookie", `token=${token}`)
      .send({ courseCode: "CS000", title: "Zero Cap", capacity: 0, semesterId: "SEM2026A" });
    expect(res.status).toBe(201);
  });

  it("rejects non-integer capacity", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .post("/api/v1/courses")
      .set("Cookie", `token=${token}`)
      .send({ courseCode: "CS111", title: "X", capacity: 30.5, semesterId: "SEM2026A" });
    expect(res.status).toBe(400);
  });

  it("rejects missing semesterId", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .post("/api/v1/courses")
      .set("Cookie", `token=${token}`)
      .send({ courseCode: "CS111", title: "X", capacity: 30 });
    expect(res.status).toBe(400);
  });

  it("rejects invalid timetable slot (bad time format)", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .post("/api/v1/courses")
      .set("Cookie", `token=${token}`)
      .send({
        courseCode: "CS999",
        title: "X",
        capacity: 30,
        semesterId: "SEM2026A",
        timetableSlots: [{ day: "Monday", start: "9:00", end: "9:50" }],
      });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/courses/:id", () => {
  it("returns 200 for a valid course ID", async () => {
    const token = makeToken(adminUser);
    const res = await request(app)
      .get(`/api/v1/courses/${sampleCourse._id}`)
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.course.courseCode).toBe("CS301");
  });

  it("returns 404 when course does not exist", async () => {
    mockCourseFindById.mockResolvedValue(null);
    const token = makeToken(adminUser);
    const res = await request(app)
      .get("/api/v1/courses/507f1f77bcf86cd799439099")
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

describe("DELETE /api/v1/courses/:id", () => {
  it("deactivates a course (admin only)", async () => {
    mockCourseFindByIdAndUpdate.mockResolvedValue({ ...sampleCourse, isActive: false });
    const token = makeToken(adminUser);
    const res = await request(app)
      .delete(`/api/v1/courses/${sampleCourse._id}`)
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(200);
  });

  it("returns 403 for non-admin roles", async () => {
    const facultyUser = { ...adminUser, role: "faculty" };
    mockUserFindById.mockResolvedValue(facultyUser);
    const token = makeToken(facultyUser);
    const res = await request(app)
      .delete(`/api/v1/courses/${sampleCourse._id}`)
      .set("Cookie", `token=${token}`);
    expect(res.status).toBe(403);
  });
});

