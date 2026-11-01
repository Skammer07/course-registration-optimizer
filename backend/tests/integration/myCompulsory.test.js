/**
 * tests/integration/myCompulsory.test.js
 * GET /api/v1/courses/my-compulsory: a student sees only their own compulsory
 * courses (department matched like the allocation does), nobody else may use it.
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

const studentUser = { _id: "507f1f77bcf86cd799440011", email: "s@t.com", role: "student", student: "507f1f77bcf86cd799440012", isActive: true };
const adminUser = { _id: "507f1f77bcf86cd799440013", email: "a@t.com", role: "admin", isActive: true };

const mockUserFindById = vi.fn();
vi.mock("../../src/models/User.js", () => ({
  default: { findById: () => ({ select: () => ({ lean: mockUserFindById }) }), findOne: vi.fn(), exists: vi.fn(), create: vi.fn() },
}));

const mockStudentFindById = vi.fn();
vi.mock("../../src/models/Student.js", () => ({
  default: { findById: () => ({ select: () => ({ lean: mockStudentFindById }) }) },
}));

const mockCourseFind = vi.fn();
vi.mock("../../src/models/Course.js", () => ({
  default: { find: (...args) => ({ sort: () => ({ lean: () => mockCourseFind(...args) }) }) },
}));

const slot = (day, start, end) => ({ day, start, end });
const compulsory = (courseCode, departments, slots, extra = {}) => ({
  courseCode, title: `${courseCode} title`, kind: "compulsory", departments, timetableSlots: slots, ...extra,
});

const token = (user) => jwt.sign({ sub: user._id, role: user.role }, "test-secret-long-enough-for-tests-only", { expiresIn: "15m" });
let app;

beforeAll(async () => {
  app = (await import("../../src/app.js")).default;
});

beforeEach(() => {
  mockUserFindById.mockResolvedValue(studentUser);
  mockStudentFindById.mockResolvedValue({ studentId: "S1", department: " cse ", semesterId: "SEM-1" });
  mockCourseFind.mockResolvedValue([
    compulsory("MA201", ["CSE", "ECE"], [slot("Monday", "09:00", "09:50")]),
    compulsory("EC-DC1", ["ECE"], [slot("Tuesday", "10:00", "10:50")]),
    compulsory("CS-DC1", ["cse"], [slot("Friday", "11:00", "11:50")]),
  ]);
});

describe("GET /api/v1/courses/my-compulsory", () => {
  const get = (user) => request(app).get("/api/v1/courses/my-compulsory").set("Cookie", `token=${token(user)}`);

  it("needs a login", async () => {
    expect((await request(app).get("/api/v1/courses/my-compulsory")).status).toBe(401);
  });

  it("is for students only", async () => {
    mockUserFindById.mockResolvedValue(adminUser);
    expect((await get(adminUser)).status).toBe(403);
  });

  it("returns the courses of the student's department, ignoring case and spacing", async () => {
    const res = await get(studentUser);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      semesterId: "SEM-1",
      department: " cse ",
      courses: [
        { courseCode: "MA201", title: "MA201 title", timetableSlots: [slot("Monday", "09:00", "09:50")] },
        { courseCode: "CS-DC1", title: "CS-DC1 title", timetableSlots: [slot("Friday", "11:00", "11:50")] },
      ],
    });
  });

  it("asks only for the student's own semester, active compulsory courses", async () => {
    await get(studentUser);
    expect(mockCourseFind).toHaveBeenCalledWith({ semesterId: "SEM-1", kind: "compulsory", isActive: true });
  });

  it("returns an empty list for a student with no department or no semester", async () => {
    mockStudentFindById.mockResolvedValue({ studentId: "S1", department: "", semesterId: "SEM-1" });
    expect((await get(studentUser)).body.data.courses).toEqual([]);

    mockStudentFindById.mockResolvedValue({ studentId: "S1", department: "CSE", semesterId: "" });
    mockCourseFind.mockClear();
    const res = await get(studentUser);
    expect(res.body.data).toEqual({ semesterId: null, department: "CSE", courses: [] });
    expect(mockCourseFind).not.toHaveBeenCalled(); // no semester: courses are never queried
  });

  it("rejects an account that is not linked to a student record", async () => {
    mockStudentFindById.mockResolvedValue(null);
    expect((await get(studentUser)).status).toBe(400);
  });
});
