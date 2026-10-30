/**
 * tests/unit/adminBootstrap.test.js
 * Creating / recovering the first admin from the command line.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("argon2", () => ({
  default: { hash: vi.fn(async (p) => `HASH(${p})`), verify: vi.fn(), argon2id: 2 },
}));

let existing = null;
const created = [];
const updated = [];
vi.mock("../../src/models/User.js", () => ({
  default: {
    findOne: () => ({ select: () => ({ lean: async () => existing }) }),
    create: async (doc) => { created.push(doc); return doc; },
    updateOne: async (f, u) => { updated.push({ f, u }); return {}; },
  },
}));
vi.mock("../../src/config/env.js", () => ({
  env: { jwtSecret: "test-secret-long-enough-for-tests-only", jwtExpiresIn: "15m", isProduction: false },
}));

const { bootstrapAdmin } = await import("../../src/services/adminBootstrap.service.js");

beforeEach(() => {
  existing = null;
  created.length = 0;
  updated.length = 0;
});

describe("bootstrapAdmin", () => {
  it("creates an admin with a generated one-time password and a forced change", async () => {
    const r = await bootstrapAdmin({ email: "  Admin@College.EDU " });
    expect(r).toMatchObject({ action: "created", email: "admin@college.edu", mustChangePassword: true });
    expect(r.password).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(created[0]).toMatchObject({
      email: "admin@college.edu", role: "admin", isActive: true, mustChangePassword: true,
      passwordHash: `HASH(${r.password})`,
    });
    expect(JSON.stringify(created[0])).not.toContain('"password":');
  });

  it("a supplied password is used as is and does not force a change", async () => {
    const r = await bootstrapAdmin({ email: "a@b.co", password: "my-long-password" });
    expect(r).toMatchObject({ action: "created", password: "my-long-password", mustChangePassword: false });
    expect(created[0].mustChangePassword).toBe(false);
  });

  it("rejects a bad email or a too-short/too-long password", async () => {
    await expect(bootstrapAdmin({ email: "nope" })).rejects.toThrow(/valid --email/);
    await expect(bootstrapAdmin({})).rejects.toThrow(/valid --email/);
    await expect(bootstrapAdmin({ email: "a@b.co", password: "short" })).rejects.toThrow(/8 to 128/);
    await expect(bootstrapAdmin({ email: "a@b.co", password: "x".repeat(129) })).rejects.toThrow(/8 to 128/);
    expect(created).toHaveLength(0);
  });

  it("refuses to touch an existing admin without --reset", async () => {
    existing = { _id: "id1", role: "admin" };
    await expect(bootstrapAdmin({ email: "a@b.co" })).rejects.toThrow(/already exists.*--reset/);
    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(0);
  });

  it("--reset issues a new temporary password, forces a change, reactivates and invalidates old tokens", async () => {
    existing = { _id: "id1", role: "admin" };
    const r = await bootstrapAdmin({ email: "a@b.co", reset: true });
    expect(r).toMatchObject({ action: "reset", mustChangePassword: true });
    const set = updated[0].u.$set;
    expect(updated[0].f).toEqual({ _id: "id1" });
    expect(set).toMatchObject({ passwordHash: `HASH(${r.password})`, mustChangePassword: true, isActive: true });
    expect(set.passwordChangedAt).toBeInstanceOf(Date);
  });

  it("never converts a non-admin account, even with --reset", async () => {
    existing = { _id: "id2", role: "student" };
    await expect(bootstrapAdmin({ email: "s@b.co", reset: true })).rejects.toThrow(/not an admin/);
    expect(updated).toHaveLength(0);
    expect(created).toHaveLength(0);
  });
});
