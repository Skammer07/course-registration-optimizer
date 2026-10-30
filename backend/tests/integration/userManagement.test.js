/**
 * tests/integration/userManagement.test.js
 * Temporary passwords, forced password change, token invalidation, and the
 * admin user-management endpoints (list, activate/deactivate, reset).
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

const SECRET = "test-secret-long-enough-for-tests-only";
const ADMIN = { _id: "507f1f77bcf86cd799440002", email: "a@t.com", role: "admin", isActive: true };
const ADMIN2 = { _id: "507f1f77bcf86cd799440012", email: "a2@t.com", role: "admin", isActive: true };
const FACULTY = { _id: "507f1f77bcf86cd799440003", email: "f@t.com", role: "faculty", isActive: true };
const TARGET = { _id: "507f1f77bcf86cd7994400b1", email: "t@t.com", role: "faculty", isActive: true, createdAt: "2026-01-01T00:00:00Z" };

const store = {};
const calls = { create: [], updateOne: [], findByIdAndUpdate: [], find: [] };
let adminCount = 1;
let existsResult = null;

vi.mock("../../src/models/User.js", () => ({
  default: {
    findById: (id) => {
      const q = { select: () => q, populate: () => q, lean: async () => (store[id] ? { ...store[id] } : null) };
      return q;
    },
    findByIdAndUpdate: (id, update) => {
      calls.findByIdAndUpdate.push({ id, update });
      const q = {
        populate: () => q,
        lean: async () => {
          if (!store[id]) return null;
          store[id] = { ...store[id], ...update.$set };
          return { ...store[id] };
        },
      };
      return q;
    },
    updateOne: async (filter, update) => {
      calls.updateOne.push({ filter, update });
      if (store[filter._id]) store[filter._id] = { ...store[filter._id], ...update.$set };
      return {};
    },
    find: (filter) => {
      calls.find.push(filter);
      const q = { populate: () => q, sort: () => q, skip: () => q, limit: () => q, lean: async () => Object.values(store) };
      return q;
    },
    countDocuments: async (f) => (f?.role === "admin" ? adminCount : Object.keys(store).length),
    exists: async () => existsResult,
    create: async (doc) => {
      calls.create.push(doc);
      return { toObject: () => ({ _id: "507f1f77bcf86cd7994400aa", ...doc, createdAt: "2026-01-01T00:00:00Z" }) };
    },
    findOne: vi.fn(),
  },
}));
vi.mock("../../src/models/Student.js", () => ({
  default: { findOne: () => ({ select: () => ({ lean: async () => ({ _id: "507f1f77bcf86cd799440099" }) }) }) },
}));

const verifyMock = vi.fn();
vi.mock("argon2", () => ({
  default: { hash: vi.fn(async (p) => `HASH(${p})`), verify: (...a) => verifyMock(...a), argon2id: 2 },
}));

let app;
beforeAll(async () => {
  app = (await import("../../src/app.js")).default;
});

const tokenFor = (u, iatOffsetSeconds = 0) =>
  jwt.sign({ sub: u._id, role: u.role, iat: Math.floor(Date.now() / 1000) + iatOffsetSeconds }, SECRET, { expiresIn: "15m" });
const as = (u, iat = 0) => ({
  get: (p) => request(app).get(p).set("Cookie", `token=${tokenFor(u, iat)}`),
  post: (p) => request(app).post(p).set("Cookie", `token=${tokenFor(u, iat)}`),
  patch: (p) => request(app).patch(p).set("Cookie", `token=${tokenFor(u, iat)}`),
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(store)) delete store[k];
  store[ADMIN._id] = { ...ADMIN };
  store[ADMIN2._id] = { ...ADMIN2 };
  store[FACULTY._id] = { ...FACULTY };
  store[TARGET._id] = { ...TARGET };
  calls.create.length = 0; calls.updateOne.length = 0; calls.findByIdAndUpdate.length = 0; calls.find.length = 0;
  adminCount = 1;
  existsResult = null;
  verifyMock.mockResolvedValue(true);
});

describe("POST /users without a password (temporary password)", () => {
  it("generates a strong temporary password, returns it once, stores only the hash and forces a change", async () => {
    const res = await as(ADMIN).post("/api/v1/users").send({ email: "New@Uni.edu", role: "faculty" });
    expect(res.status).toBe(201);
    const pw = res.body.data.temporaryPassword;
    expect(pw).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(pw).toMatch(/[A-Z]/); expect(pw).toMatch(/[a-z]/); expect(pw).toMatch(/[0-9]/);
    expect(pw).not.toMatch(/[0O1lI]/); // no look-alike characters
    expect(res.body.data.user.mustChangePassword).toBe(true);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(calls.create[0]).toMatchObject({ passwordHash: `HASH(${pw})`, mustChangePassword: true });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|HASH\(/);
  });

  it("every generated password is different", async () => {
    const a = (await as(ADMIN).post("/api/v1/users").send({ email: "a1@u.edu", role: "faculty" })).body.data.temporaryPassword;
    const b = (await as(ADMIN).post("/api/v1/users").send({ email: "a2@u.edu", role: "faculty" })).body.data.temporaryPassword;
    expect(a).not.toBe(b);
  });

  it("an admin-supplied password keeps the old behaviour (no temporary password returned)", async () => {
    const res = await as(ADMIN).post("/api/v1/users").send({ email: "n@u.edu", password: "password123", role: "faculty" });
    expect(res.status).toBe(201);
    expect(res.body.data).not.toHaveProperty("temporaryPassword");
    expect(res.body.data.user.mustChangePassword).toBe(false);
  });
});

describe("temporary password enforcement", () => {
  const locked = { ...FACULTY, mustChangePassword: true };

  it("blocks normal routes with PASSWORD_CHANGE_REQUIRED but allows /auth/me", async () => {
    store[FACULTY._id] = locked;
    const blocked = await as(FACULTY).get("/api/v1/courses");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    const me = await as(FACULTY).get("/api/v1/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.data.user.mustChangePassword).toBe(true);
  });

  it("change-password clears the flag, records the time and issues a fresh cookie", async () => {
    store[FACULTY._id] = locked;
    verifyMock.mockResolvedValue(true);
    const res = await as(FACULTY).post("/api/v1/auth/change-password").send({ currentPassword: "Temp12345678", newPassword: "MyOwnPassw0rd" });
    expect(res.status).toBe(200);
    const upd = calls.updateOne[0].update.$set;
    expect(upd).toMatchObject({ passwordHash: "HASH(MyOwnPassw0rd)", mustChangePassword: false });
    expect(upd.passwordChangedAt).toBeInstanceOf(Date);
    expect(res.headers["set-cookie"].join(";")).toMatch(/token=/);
  });

  it("a wrong current password is rejected and changes nothing", async () => {
    store[FACULTY._id] = locked;
    verifyMock.mockResolvedValue(false);
    const res = await as(FACULTY).post("/api/v1/auth/change-password").send({ currentPassword: "nope", newPassword: "MyOwnPassw0rd" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_CURRENT_PASSWORD");
    expect(calls.updateOne).toHaveLength(0);
  });

  it("the new password must differ from the current one and meet the length rules", async () => {
    store[FACULTY._id] = locked;
    expect((await as(FACULTY).post("/api/v1/auth/change-password").send({ currentPassword: "SamePassw0rd", newPassword: "SamePassw0rd" })).status).toBe(400);
    expect((await as(FACULTY).post("/api/v1/auth/change-password").send({ currentPassword: "x", newPassword: "short" })).status).toBe(400);
    expect((await as(FACULTY).post("/api/v1/auth/change-password").send({ currentPassword: "x", newPassword: "y".repeat(129) })).status).toBe(400);
    expect((await as(FACULTY).post("/api/v1/auth/change-password").send({ newPassword: "LongEnough123" })).status).toBe(400);
    expect(calls.updateOne).toHaveLength(0);
  });

  it("change-password needs a login", async () => {
    expect((await request(app).post("/api/v1/auth/change-password").send({ currentPassword: "a", newPassword: "LongEnough123" })).status).toBe(401);
  });
});

describe("token invalidation", () => {
  it("a token issued before the last password change is rejected", async () => {
    const changed = new Date(Date.now() - 5 * 60 * 1000);
    store[FACULTY._id] = { ...FACULTY, passwordChangedAt: changed };
    const old = await as(FACULTY, -600).get("/api/v1/auth/me"); // issued 10 min ago
    expect(old.status).toBe(401);
    expect(old.body.error.message).toMatch(/password was changed/i);
    const fresh = await as(FACULTY, 0).get("/api/v1/auth/me"); // issued now
    expect(fresh.status).toBe(200);
  });

  it("a deactivated user's token stops working immediately", async () => {
    expect((await as(FACULTY).get("/api/v1/auth/me")).status).toBe(200);
    store[FACULTY._id] = { ...FACULTY, isActive: false };
    expect((await as(FACULTY).get("/api/v1/auth/me")).status).toBe(401);
  });
});

describe("admin user management", () => {
  it("every user-management endpoint is admin-only", async () => {
    const reqs = [
      ["get", "/api/v1/users"], ["get", `/api/v1/users/${TARGET._id}`],
      ["patch", `/api/v1/users/${TARGET._id}/status`], ["post", `/api/v1/users/${TARGET._id}/reset-password`],
    ];
    for (const [m, p] of reqs) {
      expect((await request(app)[m](p)).status).toBe(401);
      expect((await as(FACULTY)[m](p)).status).toBe(403);
    }
  });

  it("lists users without hashes, with filters and pagination", async () => {
    const res = await as(ADMIN).get("/api/v1/users?role=faculty&isActive=true&limit=10");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ page: 1, limit: 10 });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
    expect(calls.find[0]).toMatchObject({ role: "faculty", isActive: true });
  });

  it("escapes regex characters in the email search", async () => {
    await as(ADMIN).get("/api/v1/users?search=" + encodeURIComponent("a.b*(c"));
    expect(calls.find[0].email.$regex).toBe("a\\.b\\*\\(c");
  });

  it("rejects bad query values", async () => {
    for (const q of ["?role=root", "?isActive=maybe", "?limit=0", "?limit=999", "?search=" + "x".repeat(101)]) {
      expect((await as(ADMIN).get(`/api/v1/users${q}`)).status).toBe(400);
    }
  });

  it("GET /users/:id returns one user or 404", async () => {
    expect((await as(ADMIN).get(`/api/v1/users/${TARGET._id}`)).body.data.user.email).toBe("t@t.com");
    expect((await as(ADMIN).get("/api/v1/users/507f1f77bcf86cd7994400ff")).status).toBe(404);
  });

  describe("PATCH /users/:id/status", () => {
    const patch = (id, body, u = ADMIN) => as(u).patch(`/api/v1/users/${id}/status`).send(body);

    it("deactivates and reactivates", async () => {
      const off = await patch(TARGET._id, { isActive: false });
      expect(off.status).toBe(200);
      expect(off.body.data.user.isActive).toBe(false);
      const on = await patch(TARGET._id, { isActive: true });
      expect(on.body.data.user.isActive).toBe(true);
    });

    it("an admin cannot deactivate themselves", async () => {
      const res = await patch(ADMIN._id, { isActive: false });
      expect(res.status).toBe(409);
      expect(calls.findByIdAndUpdate).toHaveLength(0);
    });

    it("the last active admin cannot be deactivated", async () => {
      adminCount = 0; // no OTHER active admin
      const res = await patch(ADMIN2._id, { isActive: false });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/last active admin/);
    });

    it("another admin can be deactivated when a second active admin exists", async () => {
      adminCount = 1;
      expect((await patch(ADMIN2._id, { isActive: false })).status).toBe(200);
    });

    it("validates the body and 404s an unknown user", async () => {
      expect((await patch(TARGET._id, { isActive: "no" })).status).toBe(400);
      expect((await patch(TARGET._id, {})).status).toBe(400);
      expect((await patch(TARGET._id, { isActive: true, role: "admin" })).status).toBe(400);
      expect((await patch("507f1f77bcf86cd7994400ff", { isActive: true })).status).toBe(404);
    });
  });

  describe("POST /users/:id/reset-password", () => {
    it("issues a new one-time temporary password, forces a change and invalidates old tokens", async () => {
      existsResult = { _id: TARGET._id };
      const res = await as(ADMIN).post(`/api/v1/users/${TARGET._id}/reset-password`);
      expect(res.status).toBe(200);
      const pw = res.body.data.temporaryPassword;
      expect(pw).toMatch(/^[A-Za-z0-9]{12}$/);
      expect(res.headers["cache-control"]).toBe("no-store");
      const upd = calls.findByIdAndUpdate[0].update.$set;
      expect(upd).toMatchObject({ passwordHash: `HASH(${pw})`, mustChangePassword: true });
      expect(upd.passwordChangedAt).toBeInstanceOf(Date);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|HASH\(/);
    });

    it("cannot reset your own password; unknown user is 404", async () => {
      expect((await as(ADMIN).post(`/api/v1/users/${ADMIN._id}/reset-password`)).status).toBe(400);
      existsResult = null;
      expect((await as(ADMIN).post("/api/v1/users/507f1f77bcf86cd7994400ff/reset-password")).status).toBe(404);
    });
  });
});

describe("generateTemporaryPassword", () => {
  it("meets the character-class rules across many samples", async () => {
    const { generateTemporaryPassword } = await import("../../src/utils/password.js");
    const seen = new Set();
    for (let i = 0; i < 300; i++) {
      const p = generateTemporaryPassword();
      expect(p).toMatch(/^[A-Za-z0-9]{12}$/);
      expect(p).toMatch(/[A-Z]/); expect(p).toMatch(/[a-z]/); expect(p).toMatch(/[2-9]/);
      expect(p).not.toMatch(/[0O1lI]/);
      seen.add(p);
    }
    expect(seen.size).toBe(300);
  });
});
