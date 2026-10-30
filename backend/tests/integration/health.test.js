/**
 * tests/integration/health.test.js
 * Integration tests for the health endpoint.
 * Uses Supertest — does NOT start a listening server.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import request from "supertest";

// Mock the env module to avoid requiring real env vars in tests
vi.mock("../../src/config/env.js", () => ({
  env: {
    port: 5000,
    nodeEnv: "test",
    mongoUri: "mongodb://test",
    jwtSecret: "test-secret-long-enough-for-tests-only",
    jwtExpiresIn: "15m",
    clientOrigin: "http://localhost:5173",
    rateLimitLoginMax: 10,
    rateLimitLoginWindowMs: 900000,
    seedAdminEmail: "",
    seedAdminPassword: "",
    isDevelopment: false,
    isTest: true,
    isProduction: false,
  },
}));

// Mock mongoose/db to avoid real DB connection
vi.mock("../../src/config/db.js", () => ({
  connectDB: vi.fn().mockResolvedValue(undefined),
  disconnectDB: vi.fn().mockResolvedValue(undefined),
  getDbStatus: vi.fn().mockReturnValue("connected"),
}));

// Mock User model to avoid DB operations in auth middleware
vi.mock("../../src/models/User.js", () => ({
  default: {
    findById: vi.fn(),
    findOne: vi.fn(),
    exists: vi.fn(),
    create: vi.fn(),
  },
}));

let app;

beforeAll(async () => {
  const mod = await import("../../src/app.js");
  app = mod.default;
});

describe("GET /health", () => {
  it("returns 200 with status ok when DB is connected", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe("ok");
    expect(res.body.services.database).toBe("connected");
  });

  it("does not expose sensitive infrastructure details", async () => {
    const res = await request(app).get("/health");
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("mongodb+srv");
    expect(body).not.toContain("password");
  });
});

describe("404 Not Found", () => {
  it("returns 404 for unknown routes", async () => {
    const res = await request(app).get("/api/v1/nonexistent");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

