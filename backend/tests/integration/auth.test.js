/**
 * tests/integration/auth.test.js
 * Integration tests for the auth endpoints.
 * Mocks DB and argon2 to run without a live database.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
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

// Mock argon2 for deterministic tests
vi.mock("argon2", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("$hashed$"),
    verify: vi.fn().mockImplementation((_hash, password) =>
      Promise.resolve(password === "correct-password")
    ),
    argon2id: 2,
  },
  hash: vi.fn().mockResolvedValue("$hashed$"),
  verify: vi.fn().mockImplementation((_hash, password) =>
    Promise.resolve(password === "correct-password")
  ),
  argon2id: 2,
}));

// Mock User model
const mockUser = {
  _id: "507f1f77bcf86cd799439011",
  email: "admin@test.com",
  role: "admin",
  isActive: true,
  passwordHash: "$hashed$",
};

vi.mock("../../src/models/User.js", () => {
  const selectMock = vi.fn().mockReturnThis();
  const leanMock = vi.fn().mockResolvedValue(mockUser);

  return {
    default: {
      findById: vi.fn().mockReturnValue({ select: selectMock, lean: leanMock }),
      findOne: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        lean: vi.fn().mockResolvedValue(mockUser),
      }),
      exists: vi.fn().mockResolvedValue(true),
      create: vi.fn(),
    },
  };
});

let app;

beforeAll(async () => {
  const mod = await import("../../src/app.js");
  app = mod.default;
});

describe("POST /api/v1/auth/login", () => {
  it("returns 200 and sets cookie on valid credentials", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@test.com", password: "correct-password" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toBeDefined();
    // Cookie should be set
    const cookies = res.headers["set-cookie"] ?? [];
    expect(cookies.some((c) => c.startsWith("token="))).toBe(true);
    // Password hash must never be in response
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    expect(JSON.stringify(res.body)).not.toContain("$hashed$");
  });

  it("returns 401 on wrong password", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "admin@test.com", password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 400 on missing email", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ password: "somepassword" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 on invalid email format", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "not-an-email", password: "somepassword" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/v1/auth/logout", () => {
  it("returns 200 and clears cookie", async () => {
    const res = await request(app).post("/api/v1/auth/logout");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("GET /api/v1/auth/me", () => {
  it("returns 401 without a token cookie", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});

