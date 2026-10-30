/**
 * tests/integration/imports.test.js
 * CSV bulk import of students (with optional logins), courses and preference
 * lists: validation reporting, dry run, skip/update, rollback, access control.
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
const ADMIN = { _id: "507f1f77bcf86cd799440002", role: "admin", isActive: true };
const FACULTY = { _id: "507f1f77bcf86cd799440003", role: "faculty", isActive: true };
const STUDENT = { _id: "507f1f77bcf86cd799440004", role: "student", student: "507f1f77bcf86cd799440005", isActive: true };
let authUser = ADMIN;

// ---- in-memory collections ----------------------------------------------------
const db = { students: [], courses: [], users: [], prefs: [] };
const calls = { studentInsert: [], userInsert: [], studentDelete: [], userDelete: [], studentBulk: [], courseInsert: [], courseDelete: [], courseBulk: [], prefBulk: [] };
const hooks = { userInsertFails: false };
let seq = 0;
const oid = () => `507f1f77bcf86cd7994${String(++seq).padStart(5, "0")}`;
const inList = (v) => v?.$in ?? null;
const chain = (fn) => { const q = { select: () => q, lean: async () => fn() }; return q; };

vi.mock("../../src/models/User.js", () => ({
  default: {
    findById: () => ({ select: () => ({ lean: async () => authUser }) }),
    find: (f) => chain(() => db.users.filter((u) => (f.student ? inList(f.student).map(String).includes(String(u.student)) : inList(f.email).includes(u.email)))),
    insertMany: async (docs) => {
      calls.userInsert.push(docs);
      if (hooks.userInsertFails) throw new Error("simulated user insert failure");
      const made = docs.map((d) => ({ ...d, _id: oid() }));
      db.users.push(...made);
      return made;
    },
    deleteMany: async (f) => { calls.userDelete.push(f); db.users = db.users.filter((u) => !inList(f._id).includes(u._id)); return {}; },
  },
}));
vi.mock("../../src/models/Student.js", () => ({
  default: {
    find: (f) => chain(() => db.students.filter((s) => inList(f.studentId).includes(s.studentId))),
    insertMany: async (docs) => {
      calls.studentInsert.push(docs);
      const made = docs.map((d) => ({ ...d, _id: oid() }));
      db.students.push(...made);
      return made;
    },
    deleteMany: async (f) => { calls.studentDelete.push(f); db.students = db.students.filter((s) => !inList(f._id).includes(s._id)); return {}; },
    bulkWrite: async (ops) => { calls.studentBulk.push(ops); return {}; },
  },
}));
vi.mock("../../src/models/Course.js", () => ({
  default: {
    find: (f) => chain(() => db.courses.filter((c) => inList(f.courseCode).includes(c.courseCode) && (!f.semesterId || inList(f.semesterId).includes(c.semesterId)))),
    insertMany: async (docs) => { calls.courseInsert.push(docs); const made = docs.map((d) => ({ ...d, _id: oid() })); db.courses.push(...made); return made; },
    deleteMany: async (f) => { calls.courseDelete.push(f); return {}; },
    bulkWrite: async (ops) => { calls.courseBulk.push(ops); return {}; },
  },
}));
vi.mock("../../src/models/Preference.js", () => ({
  default: {
    find: (f) => chain(() => db.prefs.filter((p) => inList(f.student).map(String).includes(String(p.student)))),
    bulkWrite: async (ops) => { calls.prefBulk.push(ops); return {}; },
  },
}));
vi.mock("argon2", () => ({
  default: { hash: vi.fn(async (p) => `HASH(${p})`), verify: vi.fn(), argon2id: 2 },
}));

let app;
let csvUtil;
beforeAll(async () => {
  app = (await import("../../src/app.js")).default;
  csvUtil = await import("../../src/utils/csv.js");
});

const cookie = (u) => `token=${jwt.sign({ sub: u._id, role: u.role }, SECRET, { expiresIn: "15m" })}`;
const send = (path, body, { user = ADMIN, type = "text/csv", q = "" } = {}) => {
  authUser = user;
  return request(app).post(`/api/v1/imports/${path}${q}`).set("Cookie", cookie(user)).set("Content-Type", type).send(body);
};

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  authUser = ADMIN;
  db.students = []; db.courses = []; db.users = []; db.prefs = [];
  for (const k of Object.keys(calls)) calls[k].length = 0;
  hooks.userInsertFails = false;
});

const STUDENT_CSV = [
  "studentId,name,cgpa,department,semesterId,electiveGroups,isActive",
  "s001,Asha Rao,9.1,CSE,SEM-1,A;B,true",
  "s002,Ravi K,8.4,ECE,SEM-1,A,yes",
  "s003,Meera,7.0,,SEM-1,,",
].join("\r\n");

// ===========================================================================
describe("csv utility", () => {
  it("parses quotes, embedded commas/newlines, BOM, blank lines and reports line numbers", () => {
    const text = '﻿a,b,c\r\n1,"x,y","say ""hi"""\r\n\r\n2,"multi\nline",z\n3,,\n';
    expect(csvUtil.parseCsv(text)).toEqual([
      { line: 1, cells: ["a", "b", "c"] },
      { line: 2, cells: ["1", "x,y", 'say "hi"'] },
      { line: 4, cells: ["2", "multi\nline", "z"] },
      { line: 6, cells: ["3", "", ""] },
    ]);
  });
  it("rejects an unterminated quote", () => {
    expect(() => csvUtil.parseCsv('a,"b')).toThrow(/never closed/);
  });
  it("csvCell neutralizes formulas and escapes; buildCsv uses BOM + CRLF", () => {
    expect(csvUtil.csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvUtil.csvCell('a,"b')).toBe('"a,""b"');
    expect(csvUtil.csvCell(null)).toBe("");
    const out = csvUtil.buildCsv(["x", "y"], [["1", "=2"]]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out).toBe("﻿x,y\r\n1,'=2\r\n");
  });
});

// ===========================================================================
describe("access control and request shape", () => {
  it("requires login and the admin role", async () => {
    expect((await request(app).post("/api/v1/imports/students").set("Content-Type", "text/csv").send(STUDENT_CSV)).status).toBe(401);
    expect((await send("students", STUDENT_CSV, { user: FACULTY })).status).toBe(403);
    expect((await send("courses", "a", { user: STUDENT })).status).toBe(403);
    expect((await send("preferences", "a", { user: FACULTY })).status).toBe(403);
  });

  it("a JSON or empty body is a clear 400", async () => {
    const json = await send("students", JSON.stringify({ a: 1 }), { type: "application/json" });
    expect(json.status).toBe(400);
    expect(json.body.error.message).toMatch(/text\/csv/);
    expect((await send("students", "")).status).toBe(400);
  });

  it("a body over 2 MB is 413", async () => {
    const res = await send("students", "studentId,name,cgpa\n" + "x".repeat(2.2 * 1024 * 1024));
    expect(res.status).toBe(413);
  });

  it("rejects bad query options", async () => {
    expect((await send("students", STUDENT_CSV, { q: "?onExisting=delete" })).status).toBe(400);
    expect((await send("students", STUDENT_CSV, { q: "?dryRun=maybe" })).status).toBe(400);
  });
});

// ===========================================================================
describe("POST /imports/students", () => {
  it("creates students: ids upper-cased, groups split, flags parsed, defaults applied", async () => {
    const res = await send("students", STUDENT_CSV);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ dryRun: false, totalRows: 3, created: 3, updated: 0, skipped: 0, loginsCreated: 0 });
    const docs = calls.studentInsert[0];
    expect(docs[0]).toMatchObject({ studentId: "S001", name: "Asha Rao", cgpa: 9.1, department: "CSE", semesterId: "SEM-1", electiveGroups: ["A", "B"], isActive: true });
    expect(docs[1].isActive).toBe(true); // "yes"
    expect(docs[2]).toMatchObject({ electiveGroups: [], department: "", isActive: true }); // blanks -> defaults
  });

  it("a dry run validates and reports but writes nothing", async () => {
    const res = await send("students", STUDENT_CSV, { q: "?dryRun=true" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ dryRun: true, created: 3 });
    expect(res.body.message).toMatch(/Dry run/);
    expect(calls.studentInsert).toHaveLength(0);
  });

  it("reports every problem with row and column and imports nothing", async () => {
    const csv = [
      "studentId,name,cgpa,isActive,email",
      ",NoId,8,true,",            // line 2: missing id
      "S2,,8,true,",              // line 3: missing name
      "S3,Bad,11,true,",          // line 4: cgpa out of range
      "S4,Bad,abc,true,",         // line 5: cgpa not a number
      "S5,Flag,8,maybe,",         // line 6: bad boolean
      "S2,Dup,8,true,",           // line 7: duplicate id
      "S6,Mail,8,true,not-mail",  // line 8: bad email
    ].join("\n");
    const res = await send("students", csv);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("IMPORT_VALIDATION_FAILED");
    const d = res.body.error.details;
    expect(d).toEqual(expect.arrayContaining([
      { row: 2, column: "studentId", message: expect.any(String) },
      { row: 3, column: "name", message: expect.any(String) },
      { row: 4, column: "cgpa", message: expect.any(String) },
      { row: 5, column: "cgpa", message: expect.any(String) },
      { row: 6, column: "isActive", message: expect.any(String) },
      { row: 7, column: "studentId", message: expect.stringMatching(/Duplicate/) },
      { row: 8, column: "email", message: expect.any(String) },
    ]));
    expect(calls.studentInsert).toHaveLength(0);
  });

  it("caps the reported problems at 50 but says how many there are", async () => {
    const csv = "studentId,name,cgpa\n" + Array.from({ length: 80 }, (_, i) => `S${i},N,99`).join("\n");
    const res = await send("students", csv);
    expect(res.status).toBe(422);
    expect(res.body.error.details).toHaveLength(50);
    expect(res.body.error.message).toMatch(/80 problem/);
  });

  it("structural problems: unknown column, missing column, extra values, unterminated quote, too many rows", async () => {
    const unknown = await send("students", "studentId,name,cgpa,shoeSize\nS1,A,8,42");
    expect(unknown.status).toBe(422);
    expect(unknown.body.error.details[0]).toMatchObject({ row: 1, column: "shoeSize" });
    expect((await send("students", "studentId,name\nS1,A")).status).toBe(422);
    expect((await send("students", "studentId,name,cgpa\nS1,A,8,extra")).status).toBe(422);
    expect((await send("students", 'studentId,name,cgpa\nS1,"A,8')).status).toBe(400);
    expect((await send("students", "studentId,name,cgpa")).status).toBe(400);
    const many = "studentId,name,cgpa\n" + Array.from({ length: 5001 }, (_, i) => `S${i},N,8`).join("\n");
    expect((await send("students", many)).status).toBe(400);
    expect(calls.studentInsert).toHaveLength(0);
  });

  it("header names are case/space insensitive", async () => {
    const res = await send("students", "Student ID, NAME ,CGPA\nS1,A,8");
    expect(res.status).toBe(200);
  });

  it("existing students are skipped by default and updated only on request", async () => {
    db.students.push({ _id: oid(), studentId: "S001" });
    const skip = await send("students", STUDENT_CSV);
    expect(skip.body.data).toMatchObject({ created: 2, skipped: 1, skippedStudentIds: ["S001"] });
    expect(calls.studentBulk).toHaveLength(0);

    calls.studentInsert.length = 0;
    const upd = await send("students", "studentId,name,cgpa,department\nS001,New Name,9.9,", { q: "?onExisting=update" });
    expect(upd.body.data).toMatchObject({ created: 0, updated: 1, skipped: 0 });
    const op = calls.studentBulk[0][0].updateOne;
    expect(op.filter).toEqual({ studentId: "S001" });
    expect(op.update.$set).toEqual({ name: "New Name", cgpa: 9.9 }); // empty department does not overwrite
  });

  describe("createLogins", () => {
    const withEmail = [
      "studentId,name,cgpa,email",
      "S1,Asha,9,Asha@Uni.edu",
      "S2,Ravi,8,ravi@uni.edu",
    ].join("\n");

    it("needs an email column", async () => {
      expect((await send("students", "studentId,name,cgpa\nS1,A,8", { q: "?createLogins=true" })).status).toBe(400);
    });

    it("every row needs an email", async () => {
      const res = await send("students", "studentId,name,cgpa,email\nS1,A,8,a@u.edu\nS2,B,8,", { q: "?createLogins=true" });
      expect(res.status).toBe(422);
      expect(res.body.error.details[0]).toMatchObject({ row: 3, column: "email" });
    });

    it("creates logins with unique one-time passwords, hashed, forced to change; returns them once", async () => {
      const res = await send("students", withEmail, { q: "?createLogins=true" });
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      const { credentials, credentialsCsv } = res.body.data;
      expect(res.body.data.loginsCreated).toBe(2);
      expect(credentials).toHaveLength(2);
      expect(credentials[0]).toMatchObject({ studentId: "S1", email: "asha@uni.edu" });
      expect(credentials[0].temporaryPassword).toMatch(/^[A-Za-z0-9]{12}$/);
      expect(credentials[0].temporaryPassword).not.toBe(credentials[1].temporaryPassword);
      expect(credentialsCsv.startsWith("﻿studentId,email,temporaryPassword\r\n")).toBe(true);
      for (const c of credentials) expect(credentialsCsv).toContain(c.temporaryPassword);

      const users = calls.userInsert[0];
      expect(users).toHaveLength(2);
      expect(users[0]).toMatchObject({ role: "student", mustChangePassword: true, isActive: true, email: "asha@uni.edu" });
      expect(users[0].passwordHash).toBe(`HASH(${credentials[0].temporaryPassword})`);
      expect(users[0].student).toBe(db.students.find((s) => s.studentId === "S1")._id);
      // no plaintext password is stored anywhere in what was inserted
      expect(JSON.stringify(users)).not.toContain(`"password":`);
    });

    it("a dry run creates nothing and returns no passwords", async () => {
      const res = await send("students", withEmail, { q: "?createLogins=true&dryRun=true" });
      expect(res.body.data).toMatchObject({ dryRun: true, loginsCreated: 2 });
      expect(res.body.data.credentials).toBeUndefined();
      expect(calls.userInsert).toHaveLength(0);
      expect(calls.studentInsert).toHaveLength(0);
    });

    it("an email that belongs to another account is a row error", async () => {
      db.users.push({ _id: oid(), email: "ravi@uni.edu", student: "someone-else" });
      const res = await send("students", withEmail, { q: "?createLogins=true" });
      expect(res.status).toBe(422);
      expect(res.body.error.details[0]).toMatchObject({ row: 3, column: "email" });
      expect(calls.studentInsert).toHaveLength(0);
    });

    it("duplicate emails inside the file are rejected", async () => {
      const csv = "studentId,name,cgpa,email\nS1,A,8,x@u.edu\nS2,B,8,X@u.edu";
      expect((await send("students", csv, { q: "?createLogins=true" })).status).toBe(422);
    });

    it("a student who already has a login does not get a second one", async () => {
      const existingId = oid();
      db.students.push({ _id: existingId, studentId: "S1" });
      db.users.push({ _id: oid(), email: "old@u.edu", student: existingId });
      const res = await send("students", withEmail, { q: "?createLogins=true" });
      expect(res.body.data).toMatchObject({ created: 1, skipped: 1, loginsCreated: 1 });
      expect(res.body.data.credentials.map((c) => c.studentId)).toEqual(["S2"]);
    });

    it("more than 500 logins in one import is refused", async () => {
      const csv = "studentId,name,cgpa,email\n" + Array.from({ length: 501 }, (_, i) => `S${i},N,8,s${i}@u.edu`).join("\n");
      expect((await send("students", csv, { q: "?createLogins=true" })).status).toBe(400);
    });

    it("if creating logins fails, the students this import created are removed again", async () => {
      hooks.userInsertFails = true;
      const res = await send("students", withEmail, { q: "?createLogins=true" });
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("IMPORT_FAILED");
      expect(JSON.stringify(res.body)).not.toContain("simulated");
      expect(calls.studentDelete).toHaveLength(1);
      expect(db.students).toHaveLength(0);
    });
  });
});

// ===========================================================================
describe("POST /imports/courses", () => {
  const COURSE_CSV = [
    "courseCode,title,capacity,semesterId,electiveGroup,timetable,isActive",
    'cs101,Algorithms,30,SEM-1,A,"Monday 09:00-10:00; Wed 9:00 - 10:30",true',
    "cs102,Machine Learning,25,SEM-1,A,,",
  ].join("\r\n");

  it("creates courses; weekday names (full or 3 letters) and times are normalized", async () => {
    const res = await send("courses", COURSE_CSV);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ created: 2, totalRows: 2 });
    const [a, b] = calls.courseInsert[0];
    expect(a).toMatchObject({ courseCode: "CS101", capacity: 30, electiveGroup: "A", isActive: true });
    expect(a.timetableSlots).toEqual([
      { day: "Monday", start: "09:00", end: "10:00" },
      { day: "Wednesday", start: "09:00", end: "10:30" },
    ]);
    expect(b.timetableSlots).toEqual([]);
  });

  it("reports row errors: capacity, timetable, missing fields, duplicates", async () => {
    const csv = [
      "courseCode,title,capacity,semesterId,electiveGroup,timetable",
      "C1,A,-5,SEM-1,A,",                    // 2 capacity
      "C2,B,2.5,SEM-1,A,",                   // 3 capacity
      "C3,C,10,SEM-1,A,Funday 09:00-10:00",  // 4 weekday
      "C4,D,10,SEM-1,A,Monday 11:00-10:00",  // 5 start after end
      "C5,E,10,SEM-1,A,Monday 25:00-26:00",  // 6 bad time
      "C6,F,10,SEM-1,A,whenever",            // 7 format
      ",G,10,SEM-1,A,",                      // 8 no code
      "C1,H,10,SEM-1,,",                     // 9 dup code+sem, no group
    ].join("\n");
    const res = await send("courses", csv);
    expect(res.status).toBe(422);
    const rows = res.body.error.details.map((d) => `${d.row}:${d.column}`);
    for (const expected of ["2:capacity", "3:capacity", "4:timetable", "5:timetable", "6:timetable", "7:timetable", "8:courseCode", "9:courseCode", "9:electiveGroup"]) {
      expect(rows).toContain(expected);
    }
    expect(calls.courseInsert).toHaveLength(0);
  });

  it("the same code in a different semester is allowed", async () => {
    const csv = "courseCode,title,capacity,semesterId,electiveGroup\nC1,A,10,SEM-1,A\nC1,A,10,SEM-2,A";
    expect((await send("courses", csv)).body.data.created).toBe(2);
  });

  it("existing courses (same code and semester) are skipped, or updated on request; dry run writes nothing", async () => {
    db.courses.push({ _id: oid(), courseCode: "CS101", semesterId: "SEM-1" });
    const skip = await send("courses", COURSE_CSV);
    expect(skip.body.data).toMatchObject({ created: 1, skipped: 1 });
    const upd = await send("courses", COURSE_CSV, { q: "?onExisting=update" });
    // the first call above created CS102, so both rows now exist
    expect(upd.body.data).toMatchObject({ created: 0, updated: 2 });
    expect(calls.courseBulk[0][0].updateOne.filter).toEqual({ courseCode: "CS101", semesterId: "SEM-1" });
    calls.courseInsert.length = 0;
    const dry = await send("courses", COURSE_CSV, { q: "?dryRun=true" });
    expect(dry.body.data.dryRun).toBe(true);
    expect(calls.courseInsert).toHaveLength(0);
  });

  it("parseTimetableCell handles good and bad input directly", async () => {
    const { parseTimetableCell } = await import("../../src/services/import.service.js");
    expect(parseTimetableCell("Tue 8:05-9:00").slots).toEqual([{ day: "Tuesday", start: "08:05", end: "09:00" }]);
    expect(parseTimetableCell("").slots).toEqual([]);
    expect(parseTimetableCell("Mon 10:00-09:00").error).toMatch(/before/);
    expect(parseTimetableCell("Xyz 10:00-11:00").error).toMatch(/weekday/);
  });
});

// ===========================================================================
describe("POST /imports/preferences", () => {
  const S1 = "507f1f77bcf86cd7994aa001";
  const S2 = "507f1f77bcf86cd7994aa002";
  beforeEach(() => {
    db.students.push(
      { _id: S1, studentId: "S1", semesterId: "SEM-1", electiveGroups: ["A"], isActive: true },
      { _id: S2, studentId: "S2", semesterId: "SEM-1", electiveGroups: [], isActive: true }
    );
    db.courses.push(
      { _id: "c-1", courseCode: "C1", semesterId: "SEM-1", electiveGroup: "A", isActive: true },
      { _id: "c-2", courseCode: "C2", semesterId: "SEM-1", electiveGroup: "A", isActive: true },
      { _id: "c-3", courseCode: "C3", semesterId: "SEM-1", electiveGroup: "B", isActive: true }
    );
  });
  const HEAD = "studentId,semesterId,electiveGroup,courseCode,rank\n";

  it("builds one ordered list per student/semester/group, whatever the row order", async () => {
    const csv = HEAD + "s1,SEM-1,A,C2,2\ns1,SEM-1,A,C1,1\nS2,SEM-1,A,C2,1\nS2,SEM-1,B,C3,1";
    const res = await send("preferences", csv);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ totalRows: 4, lists: 3, created: 3, status: "submitted" });
    const ops = calls.prefBulk[0].map((o) => o.updateOne);
    const s1 = ops.find((o) => String(o.filter.student) === S1);
    expect(s1.update.$set.rankedCourseIds).toEqual(["c-1", "c-2"]); // rank order, not file order
    expect(s1.update.$set.status).toBe("submitted");
    expect(s1.update.$set.submittedAt).toBeInstanceOf(Date);
    expect(s1.upsert).toBe(true);
    expect(s1.filter).toEqual({ student: S1, semesterId: "SEM-1", electiveGroup: "A" });
  });

  it("status=draft imports drafts without a submission time", async () => {
    const res = await send("preferences", HEAD + "S1,SEM-1,A,C1,1", { q: "?status=draft" });
    expect(res.body.data.status).toBe("draft");
    const set = calls.prefBulk[0][0].updateOne.update.$set;
    expect(set.status).toBe("draft");
    expect(set).not.toHaveProperty("submittedAt");
  });

  it("reports unknown student/course, wrong semester or group, ineligible group, duplicates", async () => {
    const csv = HEAD + [
      "NOPE,SEM-1,A,C1,1",   // 2 unknown student
      "S1,SEM-9,A,C1,1",     // 3 student not in that semester
      "S1,SEM-1,B,C3,1",     // 4 S1 not eligible for group B
      "S2,SEM-1,A,ZZ,1",     // 5 unknown course
      "S2,SEM-1,A,C3,2",     // 6 course is in another group
      "S2,SEM-1,A,C1,0",     // 7 bad rank
      "S2,SEM-1,A,C2,3",     // ok (S2 group A)
      "S2,SEM-1,A,C2,4",     // 9 course ranked twice
      "S2,SEM-1,A,C1,3",     // 10 rank 3 used twice
    ].join("\n");
    const res = await send("preferences", csv);
    expect(res.status).toBe(422);
    const rows = res.body.error.details.map((d) => `${d.row}:${d.column}`);
    for (const expected of ["2:studentId", "3:semesterId", "4:electiveGroup", "5:courseCode", "6:courseCode", "7:rank", "9:courseCode", "10:rank"]) {
      expect(rows).toContain(expected);
    }
    expect(calls.prefBulk).toHaveLength(0);
  });

  it("an inactive student or inactive course is rejected", async () => {
    db.students[1].isActive = false;
    db.courses[0].isActive = false;
    const res = await send("preferences", HEAD + "S1,SEM-1,A,C1,1\nS2,SEM-1,A,C2,1");
    expect(res.status).toBe(422);
    expect(res.body.error.details.map((d) => d.column).sort()).toEqual(["courseCode", "studentId"]);
  });

  it("existing lists are skipped by default, replaced on request, and a dry run writes nothing", async () => {
    db.prefs.push({ student: S1, semesterId: "SEM-1", electiveGroup: "A" });
    const csv = HEAD + "S1,SEM-1,A,C1,1\nS2,SEM-1,A,C2,1";
    const skip = await send("preferences", csv);
    expect(skip.body.data).toMatchObject({ created: 1, skipped: 1, updated: 0 });
    expect(calls.prefBulk[0]).toHaveLength(1);

    calls.prefBulk.length = 0;
    const upd = await send("preferences", csv, { q: "?onExisting=update" });
    expect(upd.body.data).toMatchObject({ created: 1, updated: 1, skipped: 0 });
    expect(calls.prefBulk[0]).toHaveLength(2);

    calls.prefBulk.length = 0;
    const dry = await send("preferences", csv, { q: "?dryRun=true" });
    expect(dry.body.data.dryRun).toBe(true);
    expect(calls.prefBulk).toHaveLength(0);
  });
});
