/**
 * tests/integration/users.test.js
 * POST /api/v1/users - admin-only creation of logins, students bound to a
 * Student record, never exposing the password hash.
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

const adminUser = { _id: "507f1f77bcf86cd799440002", email: "a@t.com", role: "admin", isActive: true };
const facultyUser = { _id: "507f1f77bcf86cd799440003", email: "f@t.com", role: "faculty", isActive: true };
const studentUser = {
  _id: "507f1f77bcf86cd799440004", email: "s@t.com", role: "student",
  student: "507f1f77bcf86cd799440005", isActive: true,
};
const STUDENT_OID = "507f1f77bcf86cd799440099";

const mockAuthFindById = vi.fn();
const mockUserCreate = vi.fn();
const mockUserExists = vi.fn();
vi.mock("../../src/models/User.js", () => ({
  default: {
    findById: () => ({ select: () => ({ lean: mockAuthFindById }) }),
    findOne: vi.fn(),
    exists: (...a) => mockUserExists(...a),
    create: (...a) => mockUserCreate(...a),
  },
}));
const mockStudentFindOne = vi.fn();
vi.mock("../../src/models/Student.js", () => ({
  default: { findOne: () => ({ select: () => ({ lean: mockStudentFindOne }) }) },
}));
vi.mock("argon2", () => ({
  default: { hash: vi.fn(async () => "HASHED"), verify: vi.fn(), argon2id: 2 },
}));

const token = (u) =>
  jwt.sign({ sub: u._id, role: u.role }, "test-secret-long-enough-for-tests-only", { expiresIn: "15m" });

let app;
beforeAll(async () => {
  app = (await import("../../src/app.js")).default;
});
beforeEach(() => {
  vi.clearAllMocks();
  mockAuthFindById.mockResolvedValue(adminUser);
  mockStudentFindOne.mockResolvedValue({ _id: STUDENT_OID });
  mockUserExists.mockResolvedValue(null);
  mockUserCreate.mockImplementation(async (doc) => ({
    toObject: () => ({ _id: "507f1f77bcf86cd7994400aa", ...doc, createdAt: "2026-01-01T00:00:00.000Z" }),
  }));
});

const post = (body, u = adminUser) =>
  request(app).post("/api/v1/users").set("Cookie", `token=${token(u)}`).send(body);

describe("POST /api/v1/users", () => {
  it("401 without a token", async () => {
    expect((await request(app).post("/api/v1/users").send({})).status).toBe(401);
  });

  it.each([["faculty", facultyUser], ["student", studentUser]])("403 for %s", async (_n, u) => {
    mockAuthFindById.mockResolvedValue(u);
    const res = await post({ email: "x@y.com", password: "password123", role: "faculty" }, u);
    expect(res.status).toBe(403);
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("creates a faculty login and never returns the password hash", async () => {
    const res = await post({ email: "Prof@Uni.edu", password: "password123", role: "faculty" });
    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ email: "prof@uni.edu", role: "faculty", student: null });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|HASHED|password123/);
    expect(mockUserCreate).toHaveBeenCalledWith(expect.objectContaining({ passwordHash: "HASHED" }));
  });

  it("creates a student login linked to the Student record", async () => {
    const res = await post({
      email: "s1@seed.local", password: "password123", role: "student", studentId: "seed0001",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.user.student).toBe(STUDENT_OID);
    expect(mockStudentFindOne).toHaveBeenCalled();
  });

  it("400 when the studentId does not exist", async () => {
    mockStudentFindOne.mockResolvedValue(null);
    const res = await post({ email: "s@seed.local", password: "password123", role: "student", studentId: "NOPE" });
    expect(res.status).toBe(400);
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("409 when the student already has a login", async () => {
    mockUserExists.mockResolvedValue({ _id: "x" });
    const res = await post({ email: "s@seed.local", password: "password123", role: "student", studentId: "SEED0001" });
    expect(res.status).toBe(409);
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("409 for a duplicate email (Mongo duplicate key)", async () => {
    mockUserCreate.mockRejectedValue(Object.assign(new Error("dup"), { code: 11000, keyValue: { email: "x" } }));
    const res = await post({ email: "dup@y.com", password: "password123", role: "admin" });
    expect(res.status).toBe(409);
  });

  it.each([
    ["short password", { email: "a@b.com", password: "short", role: "admin" }],
    ["bad email", { email: "nope", password: "password123", role: "admin" }],
    ["bad role", { email: "a@b.com", password: "password123", role: "root" }],
    ["student without studentId", { email: "a@b.com", password: "password123", role: "student" }],
    ["studentId on a non-student", { email: "a@b.com", password: "password123", role: "faculty", studentId: "S1" }],
    ["missing password", { email: "a@b.com", role: "admin" }],
  ])("400 for %s", async (_n, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(mockUserCreate).not.toHaveBeenCalled();
  });
});
