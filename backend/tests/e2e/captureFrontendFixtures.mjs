/**
 * Captures REAL API responses as test fixtures for the frontend (frontend/src/test/fixtures).
 *
 *   node tests/e2e/captureFrontendFixtures.mjs        (run from backend/)
 *
 * Run it after changing an API response the frontend reads, then run the frontend tests
 * (`cd ../frontend && npm test`). A failing test then shows exactly what the change broke.
 *
 * Needs MONGODB_URI and JWT_SECRET in backend/.env. It never touches your data: it switches to
 * a throwaway database (crt_fx_<timestamp>) filled with generated mock data and drops it at the
 * end. The two logins it creates use fixed mock passwords and exist only in that database.
 */

import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
config();
const dbName = `crt_fx_${Date.now()}`; // Atlas allows at most 38 characters
const url = new URL(process.env.MONGODB_URI);
url.pathname = `/${dbName}`;
process.env.MONGODB_URI = url.toString();
process.env.NODE_ENV = "development";
process.env.SEED_ADMIN_EMAIL = "";
process.env.RATE_LIMIT_LOGIN_MAX = "100";

const OUT = path.resolve("../frontend/src/test/fixtures");
fs.mkdirSync(OUT, { recursive: true });
const save = (name, body) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(body, null, 2) + "\n");

// the stored snapshot (every student, course and preference) is large and the UI never reads it
const withoutSnapshot = (body) => {
  const snap = body?.data?.run?.inputSnapshot;
  if (snap) for (const key of ["students", "courses", "preferences", "timetable"]) delete snap[key];
  return body;
};

const { default: request } = await import("supertest");
const { default: mongoose } = await import("mongoose");
const { default: app } = await import("../../src/app.js");
const { connectDB, disconnectDB } = await import("../../src/config/db.js");
const { hashPassword } = await import("../../src/services/auth.service.js");
const { generateDataset } = await import("../../src/seed/generateDataset.js");
const { default: User } = await import("../../src/models/User.js");
const { default: Student } = await import("../../src/models/Student.js");
const { default: Course } = await import("../../src/models/Course.js");
const { default: Preference } = await import("../../src/models/Preference.js");

const SEM = "SEM-FX";
try {
  await connectDB();
  // scarce seats: the two algorithms differ clearly (more assignments vs more students left out)
  const data = generateDataset({ scenario: "scarce-seats", size: 30, semesterId: SEM, seed: 3 });
  const students = await Student.insertMany(data.students);
  const courses = await Course.insertMany(data.courses);
  const sOid = new Map(students.map((s) => [s.studentId, s._id]));
  const cOid = new Map(courses.map((c) => [c.courseCode, c._id]));
  await Preference.insertMany(
    data.preferences.map((p) => ({
      student: sOid.get(p.studentId), semesterId: p.semesterId, electiveGroup: p.electiveGroup,
      rankedCourseIds: p.courseCodes.map((c) => cOid.get(c)), status: p.status, submittedAt: new Date(),
    }))
  );
  await User.create({ email: "admin@example.edu", passwordHash: await hashPassword("Admin-pass-123"), role: "admin", isActive: true });
  await User.create({ email: "student@example.edu", passwordHash: await hashPassword("Student-pass-123"), role: "student", student: students[0]._id, isActive: true });

  save("error-401.json", (await request(app).get("/api/v1/allocations/runs")).body);

  const admin = request.agent(app);
  save("login-admin.json", (await admin.post("/api/v1/auth/login").send({ email: "admin@example.edu", password: "Admin-pass-123" })).body);
  save("me-admin.json", (await admin.get("/api/v1/auth/me")).body);

  await admin.post("/api/v1/semesters").send({ semesterId: SEM, name: "Autumn (mock)" });
  save("semesters.json", (await admin.get("/api/v1/semesters")).body);

  const student = request.agent(app);
  save("login-student.json", (await student.post("/api/v1/auth/login").send({ email: "student@example.edu", password: "Student-pass-123" })).body);
  save("my-results-unpublished.json", (await student.get("/api/v1/allocations/my-results")).body);
  save("semester-status-open.json", (await student.get("/api/v1/semesters/me/status")).body);

  const cmp = await admin.post("/api/v1/allocations/compare").send({ semesterId: SEM, includeTimetable: true, seed: 7 });
  const single = await admin.post("/api/v1/allocations/run").send({ semesterId: SEM, algorithm: "baseline", seed: 9 });
  const cmpId = cmp.body.data.run._id;
  const singleId = single.body.data.run._id;
  save("compare-created.json", withoutSnapshot(cmp.body));

  save("summary-both.json", (await admin.get(`/api/v1/allocations/runs/${cmpId}/summary`)).body);
  save("summary-single.json", (await admin.get(`/api/v1/allocations/runs/${singleId}/summary`)).body);
  save("by-student.json", (await admin.get(`/api/v1/allocations/runs/${cmpId}/results/by-student?algorithm=baseline&limit=12&sort=cgpa`)).body);
  save("by-course.json", (await admin.get(`/api/v1/allocations/runs/${cmpId}/results/by-course?algorithm=baseline&limit=50`)).body);

  save("publish-ok.json", withoutSnapshot((await admin.post(`/api/v1/allocations/runs/${cmpId}/publish`).send({ algorithm: "baseline" })).body));
  save("runs-list.json", (await admin.get("/api/v1/allocations/runs?limit=20")).body);
  save("semester-overview.json", (await admin.get("/api/v1/semesters/overview")).body);
  save("semester-status-published.json", (await student.get("/api/v1/semesters/me/status")).body);
  save("my-results-published.json", (await student.get("/api/v1/allocations/my-results")).body);
  save("summary-published.json", (await admin.get(`/api/v1/allocations/runs/${cmpId}/summary`)).body);
  save("verify.json", (await admin.post(`/api/v1/allocations/runs/${cmpId}/verify`)).body);
  console.log(`fixtures written to ${OUT}`);
} finally {
  try {
    await mongoose.connection.dropDatabase();
    console.log(`dropped ${dbName}`);
  } catch (e) {
    console.error(`could not drop ${dbName}: ${e.message} (delete it manually in Atlas)`);
  }
  await disconnectDB();
  process.exit(0);
}
