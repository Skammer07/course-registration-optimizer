/**
 * tests/integration/dataOverview.test.js
 * Course demand, the preference-status overview, and the per-student preference filter:
 * what an admin needs to judge a semester's input data.
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

vi.mock("../../src/models/User.js", () => ({
  default: { findById: () => ({ select: () => ({ lean: async () => authUser }) }), findOne: vi.fn(), exists: vi.fn(), create: vi.fn() },
}));

// ---- fakes ------------------------------------------------------------------------------
const data = { students: [], courses: [], lists: [], demandAgg: [], distinctStudents: [], listCount: 0, prefDocs: [] };
const seen = { studentFilter: null, courseFilter: null, prefFilter: null, pipelines: [], distinct: null, count: null };
const chain = (rows) => {
  const q = { select: () => q, sort: () => q, populate: () => q, skip: () => q, limit: () => q, lean: async () => rows() };
  return q;
};
vi.mock("../../src/models/Student.js", () => ({
  default: { find: (f) => { seen.studentFilter = f; return chain(() => data.students); }, findById: vi.fn() },
}));
vi.mock("../../src/models/Course.js", () => ({
  default: { find: (f) => { seen.courseFilter = f; return chain(() => data.courses); } },
}));
vi.mock("../../src/models/Preference.js", () => ({
  default: {
    aggregate: async (pipeline) => {
      seen.pipelines.push(pipeline);
      return JSON.stringify(pipeline).includes("$unwind") ? data.demandAgg : data.lists;
    },
    countDocuments: async (f) => { seen.count = f; return data.listCount; },
    distinct: async (field, f) => { seen.distinct = { field, filter: f }; return data.distinctStudents; },
    find: (f) => { seen.prefFilter = f; return chain(() => data.prefDocs); },
  },
}));

let app;
let service;
beforeAll(async () => {
  app = (await import("../../src/app.js")).default;
  service = await import("../../src/services/dataOverview.service.js");
});
const get = (path, user = ADMIN) => {
  authUser = user;
  return request(app).get(path).set("Cookie", `token=${jwt.sign({ sub: user._id, role: user.role }, SECRET, { expiresIn: "15m" })}`);
};

beforeEach(() => {
  authUser = ADMIN;
  Object.assign(data, { students: [], courses: [], lists: [], demandAgg: [], distinctStudents: [], listCount: 0, prefDocs: [] });
  Object.assign(seen, { studentFilter: null, courseFilter: null, prefFilter: null, pipelines: [], distinct: null, count: null });
});

const stu = (n, patch = {}) => ({ _id: `s${n}`, studentId: `S${String(n).padStart(3, "0")}`, name: `Student ${n}`, cgpa: 8, department: "CSE", electiveGroups: [], isActive: true, ...patch });
const list = (student, group, status = "submitted", count = 3) => ({ student, electiveGroup: group, status, count });

// ===========================================================================
describe("classifyStudent (pure)", () => {
  const classify = (student, lists = {}, groups = ["A", "B"]) =>
    service.classifyStudent(student, groups, new Map(Object.entries(lists)));

  it("complete when every required group has a submitted list", () => {
    const r = classify({ electiveGroups: [] }, { A: { status: "submitted", count: 3 }, B: { status: "submitted", count: 2 } });
    expect(r.status).toBe("complete");
    expect(r.groups).toEqual({ A: { status: "submitted", count: 3 }, B: { status: "submitted", count: 2 } });
  });

  it("incomplete when something is drafted or missing, but something exists", () => {
    expect(classify({ electiveGroups: [] }, { A: { status: "submitted", count: 3 } }).status).toBe("incomplete"); // B missing
    expect(classify({ electiveGroups: [] }, { A: { status: "draft", count: 1 }, B: { status: "submitted", count: 3 } }).status).toBe("incomplete");
    expect(classify({ electiveGroups: [] }, { A: { status: "draft", count: 1 }, B: { status: "draft", count: 1 } }).status).toBe("incomplete");
  });

  it("none when no required group has any list", () => {
    const r = classify({ electiveGroups: [] }, {});
    expect(r.status).toBe("none");
    expect(r.groups.A).toEqual({ status: "missing", count: 0 });
  });

  it("only the student's own elective groups are required; others are not applicable", () => {
    const r = classify({ electiveGroups: ["A"] }, { A: { status: "submitted", count: 3 } });
    expect(r.status).toBe("complete");
    expect(r.groups.B).toEqual({ status: "na", count: 0 });
  });

  it("an empty electiveGroups list means every group of the semester is allowed (the submission rule)", () => {
    expect(classify({ electiveGroups: [] }, { A: { status: "submitted", count: 1 } }).status).toBe("incomplete");
  });

  it("a semester with no groups cannot be complete", () => {
    expect(classify({ electiveGroups: [] }, {}, []).status).toBe("none");
  });

  it("groups the student lists but the semester has no courses for are ignored", () => {
    expect(classify({ electiveGroups: ["A", "Z"] }, { A: { status: "submitted", count: 2 } }, ["A"]).status).toBe("complete");
  });
});

// ===========================================================================
describe("GET /semesters/:semesterId/demand", () => {
  const url = "/api/v1/semesters/SEM-1/demand";

  it("needs a login and the admin or faculty role", async () => {
    expect((await request(app).get(url)).status).toBe(401);
    expect((await get(url, STUDENT)).status).toBe(403);
    expect((await get(url, FACULTY)).status).toBe(200);
    expect((await get(url, ADMIN)).status).toBe(200);
  });

  it("returns every course of the semester, with zeros for courses nobody ranked", async () => {
    data.courses = [{ _id: "c1", courseCode: "C1" }, { _id: "c2", courseCode: "C2" }, { _id: "c3", courseCode: "C3" }];
    data.demandAgg = [{ _id: "c1", ranked: 20, firstChoice: 12, secondChoice: 5 }, { _id: "c2", ranked: 4, firstChoice: 1, secondChoice: 2 }];
    data.listCount = 30;
    data.distinctStudents = Array.from({ length: 18 }, (_, i) => `s${i}`);
    const res = await get(url);
    expect(res.body.data).toEqual({
      semesterId: "SEM-1",
      lists: 30,
      studentsWithLists: 18,
      courses: [
        { courseId: "c1", courseCode: "C1", ranked: 20, firstChoice: 12, secondChoice: 5 },
        { courseId: "c2", courseCode: "C2", ranked: 4, firstChoice: 1, secondChoice: 2 },
        { courseId: "c3", courseCode: "C3", ranked: 0, firstChoice: 0, secondChoice: 0 },
      ],
    });
  });

  it("counts only submitted lists of that semester, by position in the list", async () => {
    await get(url);
    const pipeline = seen.pipelines.find((p) => JSON.stringify(p).includes("$unwind"));
    expect(pipeline[0]).toEqual({ $match: { semesterId: "SEM-1", status: "submitted" } });
    expect(pipeline[1].$unwind).toMatchObject({ path: "$rankedCourseIds", includeArrayIndex: "position" });
    expect(seen.count).toEqual({ semesterId: "SEM-1", status: "submitted" });
    expect(seen.distinct).toEqual({ field: "student", filter: { semesterId: "SEM-1", status: "submitted" } });
  });

  it("an unknown semester is simply empty", async () => {
    const res = await get("/api/v1/semesters/NOPE/demand");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ lists: 0, studentsWithLists: 0, courses: [] });
  });
});

// ===========================================================================
describe("GET /preferences/overview", () => {
  const url = (q = "semesterId=SEM-1") => `/api/v1/preferences/overview?${q}`;
  const seed = () => {
    data.courses = [{ electiveGroup: "A" }, { electiveGroup: "A" }, { electiveGroup: "B" }, { electiveGroup: null }];
    data.students = [
      stu(1, { name: "Asha", department: "CSE" }),
      stu(2, { name: "Ravi", department: "ECE" }),
      stu(3, { name: "Meera", department: "CSE" }),
      stu(4, { name: "Kiran", department: "ECE", electiveGroups: ["A"] }),
    ];
    data.lists = [
      list("s1", "A"), list("s1", "B"),            // complete
      list("s2", "A"), list("s2", "B", "draft", 1), // incomplete (B is a draft)
      // s3: nothing -> none
      list("s4", "A", "submitted", 2),             // complete (only needs A)
    ];
  };

  it("needs a login and the admin or faculty role, and a semester", async () => {
    expect((await request(app).get(url())).status).toBe(401);
    expect((await get(url(), STUDENT)).status).toBe(403);
    expect((await get(url(), FACULTY)).status).toBe(200);
    expect((await get("/api/v1/preferences/overview")).status).toBe(400);
    expect((await get(url("semesterId="))).status).toBe(400);
  });

  it("is not shadowed by the /:id route", async () => {
    seed();
    const res = await get(url());
    expect(res.status).toBe(200);
    expect(res.body.data.students).toBeInstanceOf(Array);
  });

  it("derives the semester's groups from its active courses", async () => {
    seed();
    expect((await get(url())).body.data.groups).toEqual(["A", "B"]);
    expect(seen.courseFilter).toEqual({ semesterId: "SEM-1", isActive: true });
  });

  it("classifies each student and reports each group", async () => {
    seed();
    const rows = Object.fromEntries((await get(url())).body.data.students.map((r) => [r.studentId, r]));
    expect(rows.S001).toMatchObject({ status: "complete", groups: { A: { status: "submitted", count: 3 }, B: { status: "submitted", count: 3 } } });
    expect(rows.S002).toMatchObject({ status: "incomplete", groups: { A: { status: "submitted" }, B: { status: "draft", count: 1 } } });
    expect(rows.S003).toMatchObject({ status: "none", groups: { A: { status: "missing" }, B: { status: "missing" } } });
    expect(rows.S004).toMatchObject({ status: "complete", groups: { A: { status: "submitted" }, B: { status: "na" } } });
  });

  it("totals the whole semester, per group, ignoring the filters", async () => {
    seed();
    const { summary } = (await get(url("semesterId=SEM-1&search=asha&status=complete"))).body.data;
    expect(summary).toEqual({
      students: 4, complete: 2, incomplete: 1, none: 1,
      perGroup: { A: { submitted: 3, draft: 0, missing: 1 }, B: { submitted: 1, draft: 1, missing: 1 } },
    });
  });

  it("filters by search (name or id), department and status, then pages", async () => {
    seed();
    const ids = async (q) => (await get(url(`semesterId=SEM-1&${q}`))).body.data.students.map((r) => r.studentId);
    expect(await ids("search=ASHA")).toEqual(["S001"]);
    expect(await ids("search=s003")).toEqual(["S003"]);
    expect(await ids("department=ece")).toEqual(["S002", "S004"]);
    expect(await ids("status=none")).toEqual(["S003"]);
    expect(await ids("status=incomplete")).toEqual(["S002"]);
    expect(await ids("status=complete&department=CSE")).toEqual(["S001"]);

    const page2 = (await get(url("semesterId=SEM-1&limit=3&page=2"))).body.data;
    expect(page2).toMatchObject({ page: 2, limit: 3, total: 4, totalPages: 2 });
    expect(page2.students.map((r) => r.studentId)).toEqual(["S004"]);
  });

  it("lists the departments present so a screen can offer them", async () => {
    seed();
    expect((await get(url())).body.data.departments).toEqual(["CSE", "ECE"]);
  });

  it("leaves inactive students out unless asked, and never counts them in the totals", async () => {
    seed();
    data.students.push(stu(5, { isActive: false }));
    await get(url());
    expect(seen.studentFilter).toEqual({ semesterId: "SEM-1", isActive: true });
    const res = await get(url("semesterId=SEM-1&includeInactive=true"));
    expect(seen.studentFilter).toEqual({ semesterId: "SEM-1" });
    expect(res.body.data.students.map((r) => r.studentId)).toContain("S005");
    expect(res.body.data.students.find((r) => r.studentId === "S005").isActive).toBe(false);
    expect(res.body.data.summary.students).toBe(4); // the inactive one is not counted
  });

  it("only looks at lists of that semester", async () => {
    seed();
    await get(url());
    const pipeline = seen.pipelines.find((p) => JSON.stringify(p).includes("$project"));
    expect(pipeline[0]).toEqual({ $match: { semesterId: "SEM-1" } });
  });

  it("rejects bad query values", async () => {
    for (const q of ["status=maybe", "limit=0", "limit=500", "page=0", "includeInactive=perhaps", `search=${"x".repeat(101)}`]) {
      expect((await get(url(`semesterId=SEM-1&${q}`))).status).toBe(400);
    }
  });

  it("an empty semester is an empty overview, not an error", async () => {
    const res = await get(url());
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ groups: [], summary: { students: 0, complete: 0, incomplete: 0, none: 0 }, students: [], total: 0 });
  });
});

// ===========================================================================
describe("GET /preferences?student=", () => {
  it("passes the student filter through (with the semester), and rejects a malformed id", async () => {
    data.prefDocs = [{ _id: "p1" }];
    const res = await get("/api/v1/preferences?student=507f1f77bcf86cd799440aaa&semesterId=SEM-1");
    expect(res.status).toBe(200);
    expect(seen.prefFilter).toEqual({ student: "507f1f77bcf86cd799440aaa", semesterId: "SEM-1" });
    expect((await get("/api/v1/preferences?student=not-an-id")).status).toBe(400);
  });

  it("is closed to students", async () => {
    expect((await get("/api/v1/preferences?student=507f1f77bcf86cd799440aaa", STUDENT)).status).toBe(403);
  });
});
