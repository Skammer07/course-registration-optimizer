/**
 * tests/integration/security.test.js
 * Tests for security requirements:
 * - Sensitive fields never in responses
 * - Inactive user rejection
 * - Role escalation prevention
 * - Cookie attributes
 * - Consistent error format
 * - Body size limit
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

const mockUserFindById = vi.fn();
const mockUserFindOne  = vi.fn();

vi.mock("../../src/models/User.js", () => ({
  default: {
    findById: () => ({ select: () => ({ lean: mockUserFindById }) }),
    findOne: () => ({
      select: vi.fn().mockReturnThis(),
      lean: mockUserFindOne,
    }),
    exists: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("argon2", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("$hashed$"),
    verify: vi.fn().mockImplementation((_h, pw) => Promise.resolve(pw === "correct")),
    argon2id: 2,
  },
  hash: vi.fn().mockResolvedValue("$hashed$"),
  verify: vi.fn().mockImplementation((_h, pw) => Promise.resolve(pw === "correct")),
  argon2id: 2,
}));

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

// ── Sensitive field exclusion ─────────────────────────────────────────────────
describe("Sensitive fields never exposed", () => {
  it("login response never contains passwordHash", async () => {
    mockUserFindOne.mockResolvedValue({
      _id: "507f1f77bcf86cd799439011",
      email: "admin@test.com",
      role: "admin",
      isActive: true,
      passwordHash: "$argon2id$extremely-sensitive-hash",
    });

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@test.com", password: "correct" });

    const body = JSON.stringify(res.body);
    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain("argon2id");
    expect(body).not.toContain("extremely-sensitive-hash");
  });

  it("error responses never contain stack traces", async () => {
    const res = await request(app).get("/api/v1/students");
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("at Object.");
    expect(body).not.toContain(".js:");
  });

  it("health endpoint never exposes connection string or credentials", async () => {
    const res = await request(app).get("/health");
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("mongodb+srv");
    expect(body).not.toContain("password");
    expect(body).not.toContain("username");
  });
});

// ── Inactive user rejection ───────────────────────────────────────────────────
describe("Inactive user rejection", () => {
  it("rejects requests from deactivated accounts", async () => {
    const inactiveUser = {
      _id: "507f1f77bcf86cd799439011",
      email: "disabled@test.com",
      role: "admin",
      isActive: false, // deactivated
    };

    mockUserFindById.mockResolvedValue(inactiveUser);
    const token = makeToken(inactiveUser);
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", `token=${token}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(res.body.error.message).toMatch(/deactivated/i);
  });
});

// ── Role enforcement ──────────────────────────────────────────────────────────
describe("Role-based access control", () => {
  it("student cannot access admin-only allocation compare endpoint", async () => {
    const studentUser = {
      _id: "507f1f77bcf86cd799439022",
      email: "student@test.com",
      role: "student",
      student: "507f1f77bcf86cd799439033",
      isActive: true,
    };
    mockUserFindById.mockResolvedValue(studentUser);
    const token = makeToken(studentUser);

    const res = await request(app)
      .post("/api/v1/allocations/compare")
      .set("Cookie", `token=${token}`)
      .send({ semesterId: "SEM2026A" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("faculty cannot publish an allocation run", async () => {
    const facultyUser = {
      _id: "507f1f77bcf86cd799439044",
      email: "faculty@test.com",
      role: "faculty",
      isActive: true,
    };
    mockUserFindById.mockResolvedValue(facultyUser);
    const token = makeToken(facultyUser);

    const res = await request(app)
      .post("/api/v1/allocations/runs/507f1f77bcf86cd799440001/publish")
      .set("Cookie", `token=${token}`);

    expect(res.status).toBe(403);
  });

  it("student cannot delete a course", async () => {
    const studentUser = {
      _id: "507f1f77bcf86cd799439022",
      email: "student@test.com",
      role: "student",
      student: "507f1f77bcf86cd799439033",
      isActive: true,
    };
    mockUserFindById.mockResolvedValue(studentUser);
    const token = makeToken(studentUser);

    const res = await request(app)
      .delete("/api/v1/courses/507f1f77bcf86cd799440099")
      .set("Cookie", `token=${token}`);

    expect(res.status).toBe(403);
  });
});

// ── Cookie security attributes ────────────────────────────────────────────────
describe("Cookie security attributes", () => {
  it("login sets HttpOnly cookie", async () => {
    mockUserFindOne.mockResolvedValue({
      _id: "507f1f77bcf86cd799439011",
      email: "admin@test.com",
      role: "admin",
      isActive: true,
      passwordHash: "$hashed$",
    });

    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@test.com", password: "correct" });

    const setCookieHeader = res.headers["set-cookie"] ?? [];
    const tokenCookie = setCookieHeader.find((c) => c.startsWith("token="));
    expect(tokenCookie).toBeDefined();
    expect(tokenCookie.toLowerCase()).toContain("httponly");
  });
});

// ── JWT tampering ─────────────────────────────────────────────────────────────
describe("JWT tamper prevention", () => {
  it("rejects a token signed with the wrong secret", async () => {
    const tampered = jwt.sign(
      { sub: "507f1f77bcf86cd799439011", role: "admin" },
      "wrong-secret",
      { expiresIn: "15m" }
    );

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", `token=${tampered}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects an expired token", async () => {
    const expired = jwt.sign(
      { sub: "507f1f77bcf86cd799439011", role: "admin" },
      "test-secret-long-enough-for-tests-only",
      { expiresIn: -1 } // expired immediately
    );

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", `token=${expired}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a malformed token", async () => {
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", "token=not.a.real.jwt.token");

    expect(res.status).toBe(401);
  });
});

// ── Consistent error response shape ──────────────────────────────────────────
describe("Malformed request bodies", () => {
  it("invalid JSON is a 400 BAD_REQUEST, not a 500, and leaks no internals", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email": "a@b.com",');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("BAD_REQUEST");
    expect(JSON.stringify(res.body)).not.toMatch(/SyntaxError|Unexpected|at .*\.js/);
  });

  it("a non-JSON content type with a body still reaches validation (400), not a crash", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Content-Type", "text/plain")
      .send("hello");
    expect(res.status).toBe(400);
  });
});

describe("Consistent error response envelope", () => {
  it("all error responses have success:false and error.code", async () => {
    const endpoints = [
      { method: "get", path: "/api/v1/students" },
      { method: "get", path: "/api/v1/courses" },
      { method: "get", path: "/api/v1/preferences" },
      { method: "get", path: "/api/v1/allocations/runs" },
    ];

    for (const { method, path } of endpoints) {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe("UNAUTHORIZED");
      expect(res.body.error.message).toBeDefined();
      expect(Array.isArray(res.body.error.details)).toBe(true);
    }
  });

  it("validation errors include field-level details array", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "bad-email", password: "" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(res.body.error.details.length).toBeGreaterThan(0);
    expect(res.body.error.details[0]).toHaveProperty("field");
    expect(res.body.error.details[0]).toHaveProperty("message");
  });
});

// ── Body size limit ───────────────────────────────────────────────────────────
describe("Request body size limit", () => {
  it("rejects excessively large request bodies", async () => {
    // Generate a payload larger than 1MB
    const largePayload = { data: "x".repeat(1_100_000) };
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send(largePayload);

    // Express returns 413 for oversized bodies
    expect(res.status).toBe(413);
  });
});

