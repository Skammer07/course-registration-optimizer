/**
 * Real-database end-to-end check (NOT part of `npm test`).
 *
 *   node tests/e2e/realdb.e2e.mjs
 *
 * Uses MONGODB_URI from .env but swaps the database name for a throwaway one
 * (course_reg_e2e_<timestamp>), runs the full flow through the real Express app
 * and the real algorithm, then DROPS that database. Existing data is untouched.
 */

import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";

// Redirect to a throwaway database BEFORE the app/env modules load.
import { config } from "dotenv";
config();
const dbName = `course_reg_e2e_${Date.now()}`;
const u = new URL(process.env.MONGODB_URI);
u.pathname = `/${dbName}`;
process.env.MONGODB_URI = u.toString();
process.env.NODE_ENV = "development";
process.env.SEED_ADMIN_EMAIL = "";
process.env.RATE_LIMIT_LOGIN_MAX = "100";

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
const { default: Allocation } = await import("../../src/models/Allocation.js");
const { default: AllocationRun } = await import("../../src/models/AllocationRun.js");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
}

function skip(name, why) {
  console.log(`SKIP  ${name}  -> ${why}`);
}

const SEM = "SEM-E2E";
const adminPassword = randomBytes(12).toString("base64url");
const studentPassword = randomBytes(12).toString("base64url");

try {
  await connectDB();
  console.log(`Connected. Using throwaway database "${dbName}"\n`);

  // ---- seed ---------------------------------------------------------------
  const data = generateDataset({ scenario: "balanced", size: 30, semesterId: SEM, seed: 1 });
  const students = await Student.insertMany(data.students);
  const courses = await Course.insertMany(data.courses);
  const sOid = new Map(students.map((s) => [s.studentId, s._id]));
  const cOid = new Map(courses.map((c) => [c.courseCode, c._id]));
  await Preference.insertMany(
    data.preferences.map((p) => ({
      student: sOid.get(p.studentId),
      semesterId: p.semesterId,
      electiveGroup: p.electiveGroup,
      rankedCourseIds: p.courseCodes.map((c) => cOid.get(c)),
      status: p.status,
      submittedAt: new Date(),
    }))
  );
  await User.create({
    email: "admin@e2e.local",
    passwordHash: await hashPassword(adminPassword),
    role: "admin",
    isActive: true,
  });
  await User.create({
    email: "student@e2e.local",
    passwordHash: await hashPassword(studentPassword),
    role: "student",
    student: students[0]._id,
    isActive: true,
  });
  check("seed data written to Atlas", (await Student.countDocuments({ semesterId: SEM })) === 30,
    `${students.length} students, ${courses.length} courses, ${data.preferences.length} preference lists`);

  // ---- auth ---------------------------------------------------------------
  const admin = request.agent(app);
  const login = await admin.post("/api/v1/auth/login").send({ email: "admin@e2e.local", password: adminPassword });
  check("admin login", login.status === 200, `status ${login.status}`);

  const student = request.agent(app);
  const sLogin = await student.post("/api/v1/auth/login").send({ email: "student@e2e.local", password: studentPassword });
  check("student login", sLogin.status === 200, `status ${sLogin.status}`);

  check("student cannot run allocations", (await student.post("/api/v1/allocations/run").send({ semesterId: SEM, algorithm: "baseline" })).status === 403);
  check("unauthenticated request rejected", (await request(app).get("/api/v1/allocations/runs")).status === 401);

  // ---- request ids and health ----------------------------------------------------
  const rid = await request(app).get("/api/v1/allocations/runs").set("X-Request-Id", "e2e-trace-1");
  check("request id is echoed in the header and in the error body",
    rid.status === 401 && rid.headers["x-request-id"] === "e2e-trace-1" && rid.body?.requestId === "e2e-trace-1");
  const health0 = (await request(app).get("/health")).body;
  check("health: database + algorithm available, version, uptime, no active runs",
    health0.status === "ok" && health0.services?.database === "connected" && health0.services?.algorithm === "available" &&
      /^\d+\.\d+\.\d+$/.test(health0.algorithmVersion) && typeof health0.uptimeSeconds === "number" && health0.activeRuns === 0);

  // ---- semesters + preference deadline (real Mongoose validation) -------------
  const H = 3600 * 1000;
  const at = (ms) => new Date(Date.now() + ms).toISOString();
  const semBody = { semesterId: SEM, name: "E2E", preferencesOpenAt: at(-H), preferencesCloseAt: at(H) };
  check("admin creates a semester", (await admin.post("/api/v1/semesters").send(semBody)).status === 201);
  check("duplicate semester is 409", (await admin.post("/api/v1/semesters").send(semBody)).status === 409);
  check("close before open is 400 on create",
    (await admin.post("/api/v1/semesters").send({ semesterId: "BAD", preferencesOpenAt: at(H), preferencesCloseAt: at(-H) })).status === 400);
  check("close before open is 400 on PATCH (real Date validation)",
    (await admin.patch(`/api/v1/semesters/${SEM}`).send({ preferencesCloseAt: at(-2 * H) })).status === 400);
  check("student cannot create semesters", (await student.post("/api/v1/semesters").send(semBody)).status === 403);

  const myStatus = async () => (await student.get("/api/v1/semesters/me/status")).body?.data;
  check("status inside the window: preferences-open", (await myStatus())?.status === "preferences-open");

  const pref0 = data.preferences.find((p) => p.studentId === students[0].studentId);
  const prefBody = (status = "draft") => ({
    semesterId: SEM, electiveGroup: pref0.electiveGroup,
    rankedCourseIds: pref0.courseCodes.map((c) => String(cOid.get(c))), status,
  });
  check("student can save preferences while open", (await student.put("/api/v1/preferences/me").send(prefBody())).status === 200);

  check("admin closes preferences manually",
    (await admin.put(`/api/v1/semesters/${SEM}/preferences-state`).send({ state: "closed" })).status === 200);
  const closedTry = await student.put("/api/v1/preferences/me").send(prefBody());
  check("student edit rejected when closed (403 PREFERENCES_CLOSED)",
    closedTry.status === 403 && closedTry.body?.error?.code === "PREFERENCES_CLOSED");
  check("status when closed: allocation-pending", (await myStatus())?.status === "allocation-pending");

  check("admin returns control to the dates (auto)",
    (await admin.put(`/api/v1/semesters/${SEM}/preferences-state`).send({ state: "auto" })).status === 200);
  check("student can edit again inside the window", (await student.put("/api/v1/preferences/me").send(prefBody("submitted"))).status === 200);

  // window expires by date alone
  await admin.patch(`/api/v1/semesters/${SEM}`).send({ preferencesOpenAt: at(-3 * H), preferencesCloseAt: at(-H) });
  check("student edit rejected after the close DATE passes",
    (await student.put("/api/v1/preferences/me").send(prefBody())).body?.error?.code === "PREFERENCES_CLOSED");
  // reopen for the allocation steps
  await admin.patch(`/api/v1/semesters/${SEM}`).send({ preferencesOpenAt: at(-H), preferencesCloseAt: at(H) });

  // ---- single runs (real algorithm, real persistence) ------------------------
  const t0 = Date.now();
  const base = await admin.post("/api/v1/allocations/run").send({ semesterId: SEM, algorithm: "baseline", seed: 42 });
  check("baseline run completes", base.status === 201 || base.status === 200, `status ${base.status} in ${Date.now() - t0} ms`);
  const baseRun = base.body?.data?.run ?? base.body?.data;
  const baseId = baseRun?._id ?? baseRun?.id;

  const t1 = Date.now();
  const opt = await admin.post("/api/v1/allocations/run").send({ semesterId: SEM, algorithm: "optimized", includeTimetable: false });
  check("optimized run completes (no timetable)", opt.status === 201 || opt.status === 200, `status ${opt.status} in ${Date.now() - t1} ms`);
  const optRun = opt.body?.data?.run ?? opt.body?.data;
  const optId = optRun?._id ?? optRun?.id;

  if (!baseId || !optId) {
    console.log("Unexpected response shape:", JSON.stringify(base.body).slice(0, 400));
    throw new Error("could not read run ids");
  }

  const baseDoc = await AllocationRun.findById(baseId).lean();
  const baseStored = await Allocation.countDocuments({ run: baseId });
  check("baseline run stored as completed with seed + version",
    baseDoc.status === "completed" && baseDoc.randomSeed === 42 && !!baseDoc.algorithmVersion,
    `status=${baseDoc.status} seed=${baseDoc.randomSeed} v=${baseDoc.algorithmVersion}`);
  check("stored assignment count equals metric total",
    baseStored === baseDoc.baselineMetrics?.totalAssignments,
    `${baseStored} stored vs ${baseDoc.baselineMetrics?.totalAssignments} in metrics`);
  check("policy details stored on the run (phase split + assumptions)",
    !!baseDoc.algorithmDetails?.baseline?.phaseSummary && Array.isArray(baseDoc.algorithmDetails?.baseline?.assumptions));
  const optDoc = await AllocationRun.findById(optId).lean();
  check("optimizer run records meritRandomQuotasPreserved=false",
    optDoc.algorithmDetails?.optimized?.assumptions?.meritRandomQuotasPreserved === false);
  check("details are returned by GET /runs/:id",
    (await admin.get(`/api/v1/allocations/runs/${baseId}`)).body?.data?.run?.algorithmDetails?.baseline != null);
  check("run started while preferences open records a warning",
    (baseDoc.inputWarnings?.messages ?? []).some((m) => /still open/.test(m)));
  check("input snapshot + fingerprint stored", !!baseDoc.inputFingerprint && baseDoc.inputSnapshot?.students?.length === 30);

  // ---- reproducibility: same seed -> same assignments ------------------------
  const again = await admin.post("/api/v1/allocations/run").send({ semesterId: SEM, algorithm: "baseline", seed: 42 });
  const againId = (again.body?.data?.run ?? again.body?.data)?._id;
  const key = (docs) => docs.map((d) => `${d.student}:${d.course}`).sort().join("|");
  const a1 = await Allocation.find({ run: baseId }).lean();
  const a2 = await Allocation.find({ run: againId }).lean();
  check("same seed reproduces identical baseline assignments", a1.length > 0 && key(a1) === key(a2), `${a1.length} vs ${a2.length}`);

  // ---- combined compare run + manual compare --------------------------------
  const cmp = await admin.post("/api/v1/allocations/compare").send({ semesterId: SEM, includeTimetable: false, seed: 7 });
  check("combined compare run completes", cmp.status === 201 || cmp.status === 200, `status ${cmp.status}`);
  const runCmp = await admin.get(`/api/v1/allocations/runs/compare?runA=${baseId}&runB=${optId}`);
  check("run-vs-run comparison endpoint", runCmp.status === 200, `status ${runCmp.status}`);
  check("runs list + results pagination",
    (await admin.get("/api/v1/allocations/runs")).status === 200 &&
      (await admin.get(`/api/v1/allocations/runs/${baseId}/results`)).status === 200);

  // ---- publish: validation, idempotency, conflicts ----------------------------
  // ---- student results BEFORE publish: nothing visible ----------------------
  const before = await student.get("/api/v1/allocations/my-results");
  check("student sees nothing before publish",
    before.status === 200 && before.body.data.published === false && before.body.data.assignments.length === 0);

  check("publish without algorithm rejected", (await admin.post(`/api/v1/allocations/runs/${baseId}/publish`).send({})).status === 400);
  check("publishing an algorithm the run lacks is 400",
    (await admin.post(`/api/v1/allocations/runs/${baseId}/publish`).send({ algorithm: "optimized" })).status === 400);

  const pub = await admin.post(`/api/v1/allocations/runs/${baseId}/publish`).send({ algorithm: "baseline" });
  check("publish baseline", pub.status === 200, `status ${pub.status} ${pub.body?.error?.code ?? ""}`);
  const publishedCount = await Allocation.countDocuments({ run: baseId, status: "published" });
  check("published rows equal stored rows", publishedCount === baseStored, `${publishedCount}/${baseStored}`);
  check("run state is published", (await AllocationRun.findById(baseId).lean()).status === "published");
  check("publishing closed preferences automatically",
    (await student.put("/api/v1/preferences/me").send(prefBody())).body?.error?.code === "PREFERENCES_CLOSED");
  const afterPub = await myStatus();
  check("status after publish: results-published", afterPub?.status === "results-published" && afterPub?.preferencesOpen === false,
    `status=${afterPub?.status}`);
  // ---- dashboard views must agree with what is stored ------------------------
  const cmpId = (cmp.body?.data?.run ?? {})._id;
  const sum = (await admin.get(`/api/v1/allocations/runs/${cmpId}/summary`)).body?.data;
  const cmpDoc = await AllocationRun.findById(cmpId).lean();
  check("summary: both algorithms side by side",
    sum?.comparison?.available === true && sum.algorithms.baseline && sum.algorithms.optimized);
  check("summary: differences equal optimized minus baseline (from stored metrics)",
    sum?.comparison?.difference?.totalAssignments ===
      cmpDoc.optimizedMetrics.totalAssignments - cmpDoc.baselineMetrics.totalAssignments);
  check("summary: policy details + no snapshot lists",
    sum?.algorithms?.optimized?.details?.assumptions?.meritRandomQuotasPreserved === false &&
      !JSON.stringify(sum).includes(students[1].name));

  const byStu = (await admin.get(`/api/v1/allocations/runs/${baseId}/results/by-student?limit=200`)).body?.data;
  check("by-student: defaults to the published algorithm, lists all 30 students",
    byStu?.algorithm === "baseline" && byStu.total === 30, `algorithm=${byStu?.algorithm} total=${byStu?.total}`);
  check("by-student: assignment total equals stored rows",
    byStu?.students?.reduce((n, x) => n + x.coursesAllocated, 0) === baseStored);
  check("by-student: unallocated count equals the stored metric",
    byStu?.students?.filter((x) => x.status === "unallocated").length === baseDoc.baselineMetrics.unallocatedStudents,
    `${byStu?.students?.filter((x) => x.status === "unallocated").length} vs ${baseDoc.baselineMetrics.unallocatedStudents}`);
  const one = byStu?.students?.[0];
  check("by-student: search finds a student by id",
    (await admin.get(`/api/v1/allocations/runs/${baseId}/results/by-student?search=${one?.studentId}`)).body?.data?.students?.[0]?.studentId === one?.studentId);

  const byCrs = (await admin.get(`/api/v1/allocations/runs/${baseId}/results/by-course?limit=200`)).body?.data;
  check("by-course: seats filled equal stored rows",
    byCrs?.courses?.reduce((n, c) => n + c.assignedCount, 0) === baseStored);
  check("by-course: no course over capacity",
    byCrs?.courses?.every((c) => c.assignedCount <= c.capacity && c.seatsRemaining === c.capacity - c.assignedCount));

  const countRows = async (q) => (await admin.get(`/api/v1/allocations/runs/${baseId}/results?algorithm=baseline&limit=500${q}`)).body?.data?.total;
  check("results filter: phase=merit matches the database",
    (await countRows("&phase=merit")) === (await Allocation.countDocuments({ run: baseId, algorithm: "baseline", phase: "merit" })));
  check("results filter: rank=1 matches the database",
    (await countRows("&rank=1")) === (await Allocation.countDocuments({ run: baseId, algorithm: "baseline", preferenceRank: 1 })));
  const firstCode = byCrs?.courses?.find((c) => c.assignedCount > 0)?.courseCode;
  check("results filter: courseCode matches the database",
    (await countRows(`&courseCode=${firstCode}`)) === byCrs.courses.find((c) => c.courseCode === firstCode).assignedCount);
  check("results filter: studentId matches the database",
    (await countRows(`&studentId=${one?.studentId}`)) === one?.coursesAllocated);
  const desc = (await admin.get(`/api/v1/allocations/runs/${baseId}/results?algorithm=baseline&sort=-rank&limit=500`)).body?.data?.allocations ?? [];
  check("results sort -rank is descending",
    desc.length > 1 && desc.every((r, i) => i === 0 || desc[i - 1].preferenceRank >= r.preferenceRank));
  check("views are closed to students",
    (await student.get(`/api/v1/allocations/runs/${baseId}/results/by-student`)).status === 403);

  // ---- merit iteration, CSV export, replay, delete ----------------------------
  const meritRows = await Allocation.countDocuments({ run: baseId, algorithm: "baseline", phase: "merit" });
  const meritWithIter = await Allocation.countDocuments({ run: baseId, algorithm: "baseline", phase: "merit", iteration: { $in: [1, 2] } });
  check("merit rows store their iteration (1 or 2)", meritRows > 0 && meritRows === meritWithIter, `${meritWithIter}/${meritRows}`);
  check("random and optimizer rows have no iteration",
    (await Allocation.countDocuments({ run: optId, iteration: { $ne: null } })) === 0);

  const csvRes = await admin.get(`/api/v1/allocations/runs/${baseId}/export`).buffer(true).parse((res, cb) => {
    let d = ""; res.setEncoding("utf8"); res.on("data", (c) => (d += c)); res.on("end", () => cb(null, d));
  });
  const csvLines = String(csvRes.body).replace(/^\uFEFF/, "").trimEnd().split("\r\n");
  check("CSV export: attachment, header + one row per stored assignment",
    csvRes.status === 200 && /text\/csv/.test(csvRes.headers["content-type"]) &&
      /attachment; filename="allocation-/.test(csvRes.headers["content-disposition"]) &&
      csvLines.length === baseStored + 1 && csvLines[0].startsWith("runId,semesterId,algorithm,studentId"),
    `${csvLines.length - 1} rows, ${baseStored} stored`);
  check("CSV export is closed to students",
    (await student.get(`/api/v1/allocations/runs/${baseId}/export`)).status === 403);

  const vBase = (await admin.post(`/api/v1/allocations/runs/${baseId}/verify?algorithm=baseline`)).body?.data;
  check("replay: baseline from snapshot + seed reproduces the stored rows",
    vBase?.allMatch === true && vBase.results[0].storedCount === baseStored && vBase.results[0].sameVersion === true,
    `matches=${vBase?.results?.[0]?.matches}`);
  const vBoth = (await admin.post(`/api/v1/allocations/runs/${cmpId}/verify`)).body?.data;
  check("replay: both algorithms of the compare run match",
    vBoth?.allMatch === true && vBoth.results.length === 2, `${vBoth?.results?.map((r) => r.algorithm + ":" + r.matches)}`);

  // tamper with one stored row of an unpublished run: the replay must notice
  const victim = await Allocation.findOne({ run: againId, algorithm: "baseline" }).lean();
  await Allocation.updateOne({ _id: victim._id }, { $set: { preferenceRank: 99 } });
  const vBad = (await admin.post(`/api/v1/allocations/runs/${againId}/verify?algorithm=baseline`)).body?.data;
  check("replay detects a tampered stored row",
    vBad?.allMatch === false && vBad.results[0].onlyInStored.length === 1 && vBad.results[0].onlyInReplay.length === 1);

  check("delete: published run is refused (409) and kept",
    (await admin.del(`/api/v1/allocations/runs/${baseId}`)).status === 409 && !!(await AllocationRun.findById(baseId).lean()));
  const delRes = await admin.del(`/api/v1/allocations/runs/${againId}`);
  check("delete: unpublished run is removed with its assignments",
    delRes.status === 200 && !(await AllocationRun.findById(againId).lean()) &&
      (await Allocation.countDocuments({ run: againId })) === 0);
  check("cancel: a completed run cannot be cancelled (409)",
    (await admin.post(`/api/v1/allocations/runs/${optId}/cancel`)).status === 409);
  check("run management is closed to students",
    (await student.post(`/api/v1/allocations/runs/${optId}/cancel`)).status === 403 &&
      (await student.del(`/api/v1/allocations/runs/${optId}`)).status === 403);

  // ---- student results AFTER publish: only own rows -------------------------
  const mine = await student.get("/api/v1/allocations/my-results");
  const ownRows = await Allocation.find({ run: baseId, student: students[0]._id, algorithm: "baseline", status: "published" }).lean();
  check("student sees exactly their own published assignments",
    mine.status === 200 && mine.body.data.published === true &&
      mine.body.data.assignments.length === ownRows.length && ownRows.length > 0,
    `${mine.body.data.assignments.length} shown, ${ownRows.length} stored`);
  check("student results leak no CGPA or other students",
    !/cgpa/i.test(JSON.stringify(mine.body)) && !JSON.stringify(mine.body).includes(students[1].studentId));
  check("student can look up the published run of their semester",
    (await student.get("/api/v1/allocations/published")).body?.data?.run?.algorithm === "baseline");
  check("student cannot look up another semester",
    (await student.get("/api/v1/allocations/published?semesterId=OTHER")).status === 403);
  check("admin has no my-results (403)", (await admin.get("/api/v1/allocations/my-results")).status === 403);
  check("admin published lookup works",
    (await admin.get(`/api/v1/allocations/published?semesterId=${SEM}`)).body?.data?.published === true);

  check("repeat publish is idempotent (200)",
    (await admin.post(`/api/v1/allocations/runs/${baseId}/publish`).send({ algorithm: "baseline" })).status === 200);

  // ---- concurrent publish race on a real server -------------------------------
  const raceRes = await admin.post("/api/v1/allocations/run").send({ semesterId: SEM, algorithm: "optimized", includeTimetable: false });
  const raceId = (raceRes.body?.data?.run ?? raceRes.body?.data)?._id;
  const raceStored = await Allocation.countDocuments({ run: raceId });
  const race = await Promise.all(
    Array.from({ length: 6 }, () =>
      request.agent(app).set("Cookie", login.headers["set-cookie"]).post(`/api/v1/allocations/runs/${raceId}/publish`).send({ algorithm: "optimized" })
    )
  );
  const codes = race.map((r) => r.status).sort().join(",");
  const raceDoc = await AllocationRun.findById(raceId).lean();
  const racePublished = await Allocation.countDocuments({ run: raceId, status: "published" });
  check("race: run ends published exactly once, no duplicate/partial rows",
    raceDoc.status === "published" && racePublished === raceStored && race.some((r) => r.status === 200) && race.every((r) => [200, 409].includes(r.status)),
    `statuses [${codes}], published ${racePublished}/${raceStored}`);

  // ---- role boundaries on real data -----------------------------------------
  check("student can read own preferences", (await student.get("/api/v1/preferences/me")).status === 200);
  check("student cannot list all preferences", (await student.get("/api/v1/preferences")).status === 403);

  // ---- bad input ----------------------------------------------------------
  check("ratios not summing to 1 rejected",
    (await admin.post("/api/v1/allocations/compare").send({ semesterId: SEM, meritRatio: 0.5, randomRatio: 0.2 })).status === 400);
  check("empty semester gives 400, not a crash",
    (await admin.post("/api/v1/allocations/run").send({ semesterId: "NO-SUCH", algorithm: "baseline" })).status === 400);

  {
  // ---- user management: temporary passwords, forced change, reset, deactivate ---
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const adminId = login.body?.data?.user?._id;
  const TEMP_EMAIL = "temp.user@e2e.local";
  const mk = await admin.post("/api/v1/users").send({ email: TEMP_EMAIL, role: "faculty" });
  const tempPw = mk.body?.data?.temporaryPassword;
  check("admin creates a login without a password and gets a one-time temporary one",
    mk.status === 201 && /^[A-Za-z0-9]{12}$/.test(tempPw ?? "") && mk.body.data.user.mustChangePassword === true);
  const storedUser = await User.findOne({ email: TEMP_EMAIL }).select("+passwordHash").lean();
  check("only an argon2 hash is stored, never the password",
    storedUser.passwordHash.startsWith("$argon2") && !JSON.stringify(storedUser).includes(tempPw));

  const tu = request.agent(app);
  const tl = await tu.post("/api/v1/auth/login").send({ email: TEMP_EMAIL, password: tempPw });
  check("temporary password logs in and is flagged mustChangePassword",
    tl.status === 200 && tl.body?.data?.user?.mustChangePassword === true);
  const oldCookie = tl.headers["set-cookie"];
  const blockedTemp = await tu.get("/api/v1/courses");
  check("normal routes are blocked until the password is changed",
    blockedTemp.status === 403 && blockedTemp.body?.error?.code === "PASSWORD_CHANGE_REQUIRED");
  check("/auth/me still works while blocked", (await tu.get("/api/v1/auth/me")).status === 200);
  check("a wrong current password is refused",
    (await tu.post("/api/v1/auth/change-password").send({ currentPassword: "wrong-password", newPassword: "BrandNewPass123" })).body?.error?.code === "INVALID_CURRENT_PASSWORD");
  await sleep(1100);
  check("change-password succeeds",
    (await tu.post("/api/v1/auth/change-password").send({ currentPassword: tempPw, newPassword: "BrandNewPass123" })).status === 200);
  check("after the change, normal routes work (fresh cookie)", (await tu.get("/api/v1/courses")).status === 200);
  check("the token issued before the change is rejected",
    (await request(app).get("/api/v1/auth/me").set("Cookie", oldCookie)).status === 401);
  check("the old temporary password no longer logs in",
    (await request(app).post("/api/v1/auth/login").send({ email: TEMP_EMAIL, password: tempPw })).status === 401);
  const reLogin = await request(app).post("/api/v1/auth/login").send({ email: TEMP_EMAIL, password: "BrandNewPass123" });
  check("the new password logs in without the change flag",
    reLogin.status === 200 && reLogin.body?.data?.user?.mustChangePassword === false);

  const tUserId = mk.body.data.user._id;
  await sleep(1100);
  const rs = await admin.post(`/api/v1/users/${tUserId}/reset-password`);
  const tempPw2 = rs.body?.data?.temporaryPassword;
  check("admin reset issues a new one-time temporary password",
    rs.status === 200 && /^[A-Za-z0-9]{12}$/.test(tempPw2 ?? "") && tempPw2 !== tempPw && rs.headers["cache-control"] === "no-store");
  check("the existing session of that user is invalidated by the reset", (await tu.get("/api/v1/auth/me")).status === 401);
  check("the previous password stops working after a reset",
    (await request(app).post("/api/v1/auth/login").send({ email: TEMP_EMAIL, password: "BrandNewPass123" })).status === 401);
  const afterReset = await request(app).post("/api/v1/auth/login").send({ email: TEMP_EMAIL, password: tempPw2 });
  check("the reset temporary password works and must be changed again",
    afterReset.status === 200 && afterReset.body?.data?.user?.mustChangePassword === true);
  check("an admin cannot reset their own password (use change-password)",
    (await admin.post(`/api/v1/users/${adminId}/reset-password`)).status === 400);

  check("an admin cannot deactivate themselves",
    (await admin.patch(`/api/v1/users/${adminId}/status`).send({ isActive: false })).status === 409);
  const sessionBefore = afterReset.headers["set-cookie"];
  const off = await admin.patch(`/api/v1/users/${tUserId}/status`).send({ isActive: false });
  check("deactivation works", off.status === 200 && off.body?.data?.user?.isActive === false);
  check("a deactivated user can no longer log in",
    (await request(app).post("/api/v1/auth/login").send({ email: TEMP_EMAIL, password: tempPw2 })).status === 401);
  check("a deactivated user token stops working immediately",
    (await request(app).get("/api/v1/auth/me").set("Cookie", sessionBefore)).status === 401);
  check("reactivation restores login",
    (await admin.patch(`/api/v1/users/${tUserId}/status`).send({ isActive: true })).status === 200 &&
      (await request(app).post("/api/v1/auth/login").send({ email: TEMP_EMAIL, password: tempPw2 })).status === 200);

  const listed = await admin.get("/api/v1/users?search=temp.user&limit=10");
  check("user list: search finds the account, no password hashes exposed",
    listed.status === 200 && listed.body?.data?.users?.length === 1 && !/passwordHash/.test(JSON.stringify(listed.body)));
  check("user list: filter by role", (await admin.get("/api/v1/users?role=admin")).body?.data?.users?.every((u) => u.role === "admin"));
  check("user management is closed to students", (await student.get("/api/v1/users")).status === 403);

  // ---- admin bootstrap command (runs against this throwaway database) -----------
  const runCli = (args) =>
    new Promise((resolve) => {
      execFile(process.execPath, ["scripts/create-admin.js", ...args], { env: process.env, timeout: 60000 },
        (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr }));
    });
  const boot = await runCli(["--email", "boot@e2e.local"]);
  const bootPw = /Temporary password \(shown once\): (\S+)/.exec(boot.stdout)?.[1];
  check("create-admin: creates an admin and prints a one-time password", boot.code === 0 && /^[A-Za-z0-9]{12}$/.test(bootPw ?? ""));
  const bootLogin = await request(app).post("/api/v1/auth/login").send({ email: "boot@e2e.local", password: bootPw });
  check("create-admin: the new admin can log in and must change the password",
    bootLogin.status === 200 && bootLogin.body?.data?.user?.role === "admin" && bootLogin.body.data.user.mustChangePassword === true);
  check("create-admin: refuses to touch an existing admin without --reset",
    (await runCli(["--email", "boot@e2e.local"])).code === 1);
  const bootReset = await runCli(["--email", "boot@e2e.local", "--reset"]);
  const bootPw2 = /Temporary password \(shown once\): (\S+)/.exec(bootReset.stdout)?.[1];
  check("create-admin --reset: issues a new password and the old one stops working",
    bootReset.code === 0 && !!bootPw2 && bootPw2 !== bootPw &&
      (await request(app).post("/api/v1/auth/login").send({ email: "boot@e2e.local", password: bootPw })).status === 401 &&
      (await request(app).post("/api/v1/auth/login").send({ email: "boot@e2e.local", password: bootPw2 })).status === 200);
  check("create-admin: never converts a non-admin account",
    (await runCli(["--email", TEMP_EMAIL, "--reset"])).code === 1);

  // ---- CSV bulk import feeding the algorithms ------------------------------------
  const IMP = "SEM-IMP";
  const csvPost = (path, body, q = "") => admin.post(`/api/v1/imports/${path}${q}`).set("Content-Type", "text/csv").send(body);
  const pad3 = (n) => String(n).padStart(3, "0");
  const N = 40;
  const studentCsv = ["studentId,name,cgpa,department,semesterId,electiveGroups,email"]
    .concat(Array.from({ length: N }, (_, i) => `IMP${pad3(i + 1)},Imported ${i + 1},${(6 + (i % 40) / 10).toFixed(1)},CSE,${IMP},A;B,imp${pad3(i + 1)}@e2e.local`)).join("\n");
  const slots = ["Mon 09:00-10:00", "Tue 09:00-10:00", "Wed 09:00-10:00", "Thu 09:00-10:00", "Mon 11:00-12:00", "Tue 11:00-12:00", "Wed 11:00-12:00", "Thu 11:00-12:00"];
  const courseRows = [];
  ["A", "B"].forEach((g, gi) => { for (let k = 1; k <= 4; k++) courseRows.push(`IMP${g}${k},Imported ${g}${k},12,${IMP},${g},${slots[gi * 4 + k - 1]}`); });
  const courseCsv = ["courseCode,title,capacity,semesterId,electiveGroup,timetable"].concat(courseRows).join("\n");
  const prefRows = [];
  for (let i = 0; i < N; i++) {
    for (const g of ["A", "B"]) for (let r = 1; r <= 3; r++) prefRows.push(`IMP${pad3(i + 1)},${IMP},${g},IMP${g}${((i + r - 1) % 4) + 1},${r}`);
  }
  const prefCsv = ["studentId,semesterId,electiveGroup,courseCode,rank"].concat(prefRows).join("\n");

  const studentsBefore = await Student.countDocuments();
  const bad = await csvPost("students", studentCsv.replace("IMP005,Imported 5,6.4", "IMP005,Imported 5,99"));
  check("student import: a bad row gives 422 with the row number and writes nothing",
    bad.status === 422 && bad.body?.error?.details?.some((d) => d.row === 6 && d.column === "cgpa") && (await Student.countDocuments()) === studentsBefore);
  const dry = await csvPost("students", studentCsv, "?dryRun=true&createLogins=true");
  check("student import: dry run reports 40 creates + 40 logins and writes nothing",
    dry.status === 200 && dry.body?.data?.created === N && dry.body.data.loginsCreated === N && (await Student.countDocuments()) === studentsBefore);
  const importStart = Date.now();
  const imp = await csvPost("students", studentCsv, "?createLogins=true");
  const impMs = Date.now() - importStart;
  check("student import: 40 students + 40 logins created", imp.status === 200 && imp.body?.data?.created === N && imp.body.data.credentials?.length === N,
    `${impMs} ms`);
  check("student import: logins are hashed, forced to change, linked to the student",
    (await User.countDocuments({ email: /@e2e\.local$/, mustChangePassword: true, role: "student" })) === N);
  check("student import: credentials CSV is returned once",
    imp.body?.data?.credentialsCsv?.startsWith("﻿studentId,email,temporaryPassword") && imp.headers["cache-control"] === "no-store");
  const again = await csvPost("students", studentCsv, "?createLogins=true");
  check("student import: running it again skips existing students and creates no new logins",
    again.body?.data?.created === 0 && again.body.data.skipped === N && again.body.data.loginsCreated === 0 && !again.body.data.credentials?.length);
  const upd = await csvPost("students", "studentId,name,cgpa,department\nIMP001,Renamed Student,9.5,", "?onExisting=update");
  const renamed = await Student.findOne({ studentId: "IMP001" }).lean();
  check("student import: update mode changes the fields but empty cells do not overwrite",
    upd.body?.data?.updated === 1 && renamed.name === "Renamed Student" && renamed.cgpa === 9.5 && renamed.department === "CSE");

  const crs = await csvPost("courses", courseCsv);
  check("course import: 8 courses created with parsed timetable slots",
    crs.status === 200 && crs.body?.data?.created === 8 &&
      JSON.stringify((await Course.findOne({ courseCode: "IMPA1" }).lean()).timetableSlots) === JSON.stringify([{ day: "Monday", start: "09:00", end: "10:00" }]));
  const badPref = await csvPost("preferences", prefCsv.replace("IMP001,SEM-IMP,A,IMPA1,1", "IMP001,SEM-IMP,A,IMPB1,1"));
  check("preference import: a course from another group gives 422 and writes nothing",
    badPref.status === 422 && (await Preference.countDocuments({ semesterId: IMP })) === 0);
  const pr = await csvPost("preferences", prefCsv);
  check("preference import: 80 lists (40 students x 2 groups) created",
    pr.status === 200 && pr.body?.data?.lists === 2 * N && (await Preference.countDocuments({ semesterId: IMP })) === 2 * N,
    `${pr.body?.data?.lists} lists`);
  const firstList = await Preference.findOne({ semesterId: IMP, electiveGroup: "A" }).populate("rankedCourseIds", "courseCode").lean();
  check("preference import: lists are stored in rank order and submitted",
    firstList.status === "submitted" && firstList.rankedCourseIds.length === 3 && !!firstList.submittedAt);

  const impBase = await admin.post("/api/v1/allocations/run").send({ semesterId: IMP, algorithm: "baseline", seed: 11, includeTimetable: true });
  const impOpt = await admin.post("/api/v1/allocations/run").send({ semesterId: IMP, algorithm: "optimized", includeTimetable: false });
  const impBaseRun = (impBase.body?.data?.run ?? {});
  const impOptRun = (impOpt.body?.data?.run ?? {});
  check("imported data runs through the baseline (with its imported timetable)",
    impBase.status === 201 && impBaseRun.status === "completed" && impBaseRun.baselineMetrics?.totalAssignments > 0 &&
      impBaseRun.baselineValidation?.valid === true && impBaseRun.baselineMetrics.constraintViolations === 0,
    `${impBaseRun.baselineMetrics?.totalAssignments} assignments`);
  check("imported data runs through the optimizer",
    impOpt.status === 201 && impOptRun.status === "completed" && impOptRun.optimizedMetrics?.totalAssignments > 0 && impOptRun.optimizedValidation?.valid === true,
    `${impOptRun.optimizedMetrics?.totalAssignments} assignments`);

  const impStuOverview = () => student.get("/api/v1/semesters/overview");
  // ---- semester overview: what the New run screen offers instead of a typed id ----------------
  const ov = await admin.get("/api/v1/semesters/overview");
  const ovRows = ov.body?.data?.semesters ?? [];
  const imp2 = ovRows.find((x) => x.semesterId === IMP);
  const e2e2 = ovRows.find((x) => x.semesterId === SEM);
  check("overview: imported data with no semester record is listed with its real counts",
    ov.status === 200 && imp2?.students === N && imp2.courses === 8 && imp2.preferenceLists === 2 * N && imp2.recordExists === false && imp2.runs === 2,
    JSON.stringify(imp2));
  check("overview: a semester with an admin record and a published run is flagged", e2e2?.recordExists === true && e2e2.published === true && e2e2.students > 0,
    JSON.stringify(e2e2));
  check("overview: semesters that hold students come first", ovRows.slice(0, 2).every((x) => x.students > 0));
  check("overview is closed to students", (await impStuOverview()).status === 403);

  // ---- demand per course, preference overview, per-student lists (data screens) ---------------
  const dem = (await admin.get(`/api/v1/semesters/${IMP}/demand`)).body?.data;
  const sumOf = (rows, key) => rows.reduce((n, r) => n + r[key], 0);
  check("demand: counts every ranked entry of the imported lists (40 students x 2 groups x 3 courses)",
    dem?.lists === 2 * N && dem.studentsWithLists === N && dem.courses.length === 8 && sumOf(dem.courses, "ranked") === 6 * N,
    `lists=${dem?.lists} students=${dem?.studentsWithLists} ranked=${dem && sumOf(dem.courses, "ranked")}`);
  check("demand: every list has exactly one first and one second choice",
    sumOf(dem.courses, "firstChoice") === 2 * N && sumOf(dem.courses, "secondChoice") === 2 * N);
  check("demand: no course is ranked by more students than exist", dem.courses.every((c) => c.ranked <= N));

  const ovA = (await admin.get(`/api/v1/preferences/overview?semesterId=${IMP}&limit=200`)).body?.data;
  check("overview: all 40 imported students have submitted both lists",
    ovA?.summary?.students === N && ovA.summary.complete === N && ovA.summary.none === 0 &&
      JSON.stringify(ovA.groups) === JSON.stringify(["A", "B"]) && ovA.total === N,
    JSON.stringify(ovA?.summary));
  check("overview: per-group totals add up", ovA?.summary?.perGroup?.A?.submitted === N && ovA.summary.perGroup.B.submitted === N);

  // turn one student into a draft and delete another list entirely, then look again
  const imp3 = await Student.findOne({ studentId: "IMP003" }).lean();
  const imp4 = await Student.findOne({ studentId: "IMP004" }).lean();
  await Preference.updateOne({ student: imp3._id, semesterId: IMP, electiveGroup: "B" }, { $set: { status: "draft" } });
  await Preference.deleteMany({ student: imp4._id, semesterId: IMP });
  const ovB = (await admin.get(`/api/v1/preferences/overview?semesterId=${IMP}&limit=200`)).body?.data;
  const rowOf = (id) => ovB.students.find((r) => r.studentId === id);
  check("overview: a draft list makes the student incomplete; no lists at all is not started",
    ovB.summary.complete === N - 2 && ovB.summary.incomplete === 1 && ovB.summary.none === 1 &&
      rowOf("IMP003").status === "incomplete" && rowOf("IMP003").groups.B.status === "draft" &&
      rowOf("IMP004").status === "none" && rowOf("IMP004").groups.A.status === "missing",
    JSON.stringify(ovB.summary));
  check("demand: drafts are not counted (a run would not use them)",
    (await admin.get(`/api/v1/semesters/${IMP}/demand`)).body.data.lists === 2 * N - 3);
  const onlyNone = (await admin.get(`/api/v1/preferences/overview?semesterId=${IMP}&status=none`)).body?.data;
  check("overview: the status filter finds the student who has not started",
    onlyNone.total === 1 && onlyNone.students[0].studentId === "IMP004");
  const found = (await admin.get(`/api/v1/preferences/overview?semesterId=${IMP}&search=imported%2012`)).body?.data;
  check("overview: search by name works", found.students.some((r) => r.studentId === "IMP012"));

  const imp1 = await Student.findOne({ studentId: "IMP001" }).lean();
  const mine = (await admin.get(`/api/v1/preferences?student=${imp1._id}&semesterId=${IMP}`)).body?.data;
  check("a student's own lists can be fetched, in rank order with course titles",
    mine?.preferences?.length === 2 && mine.preferences.every((p) => p.rankedCourseIds.length === 3 && p.rankedCourseIds[0].courseCode && p.rankedCourseIds[0].title),
    `${mine?.preferences?.length} lists`);
  check("these data screens are closed to students",
    (await impStuOverview()).status === 403 && (await student.get(`/api/v1/semesters/${IMP}/demand`)).status === 403 &&
      (await student.get(`/api/v1/preferences/overview?semesterId=${IMP}`)).status === 403);

  // an imported student signs in with the one-time password from the import
  const cred = imp.body?.data?.credentials?.find((c) => c.studentId === "IMP002");
  const impStu = request.agent(app);
  const impLogin = await impStu.post("/api/v1/auth/login").send({ email: cred.email, password: cred.temporaryPassword });
  check("an imported student logs in with the temporary password and must change it",
    impLogin.status === 200 && impLogin.body?.data?.user?.mustChangePassword === true && (await impStu.get("/api/v1/preferences/me")).status === 403);
  await impStu.post("/api/v1/auth/change-password").send({ currentPassword: cred.temporaryPassword, newPassword: "ImportedStudent123" });
  const myPrefs = await impStu.get(`/api/v1/preferences/me?semesterId=${IMP}`);
  check("after changing it, the student sees the preferences that were imported for them",
    myPrefs.status === 200 && myPrefs.body?.data?.preferences?.length === 2);
  check("imports are closed to students", (await impStu.post("/api/v1/imports/students").set("Content-Type", "text/csv").send(studentCsv)).status === 403);

  }

  // ---- stale-run sweep on real documents ------------------------------------------
  {
    const { failStaleRuns } = await import("../../src/services/runMaintenance.service.js");
    const mkRun = async (ageMs, semesterId) => {
      const r = await AllocationRun.create({ semesterId, status: "running", createdBy: new mongoose.Types.ObjectId() });
      // createdAt is immutable in Mongoose (updates are silently ignored), so back-date through the raw collection
      if (ageMs) await AllocationRun.collection.updateOne({ _id: r._id }, { $set: { createdAt: new Date(Date.now() - ageMs) } });
      return r;
    };
    const stale = await mkRun(10 * 60 * 1000, "SWEEP-OLD");
    const fresh = await mkRun(0, "SWEEP-NEW");
    const anyStudent = new mongoose.Types.ObjectId();
    await Allocation.create({ run: stale._id, student: anyStudent, course: new mongoose.Types.ObjectId(), algorithm: "baseline", preferenceRank: 1 });
    const swept = await failStaleRuns();
    const staleAfter = await AllocationRun.findById(stale._id).lean();
    const freshAfter = await AllocationRun.findById(fresh._id).lean();
    check("sweep: an old 'running' run is marked failed and its partial assignments are removed",
      swept.failed >= 1 && staleAfter.status === "failed" && /server restart or crash/.test(staleAfter.errorSummary) &&
        (await Allocation.countDocuments({ run: stale._id })) === 0, `failed=${swept.failed}`);
    check("sweep: a recent 'running' run is left alone", freshAfter.status === "running");
    await AllocationRun.deleteOne({ _id: fresh._id });
    await AllocationRun.deleteOne({ _id: stale._id });
  }

  // ---- cancel a genuinely long-running run -----------------------------------
  await Preference.deleteMany({}); await Student.deleteMany({}); await Course.deleteMany({});
  const HEAVY = "SEM-HEAVY";
  const hd = generateDataset({ scenario: "many-ties", size: 200, semesterId: HEAVY, seed: 1 });
  const hs = await Student.insertMany(hd.students);
  const hc = await Course.insertMany(hd.courses);
  const hso = new Map(hs.map((x) => [x.studentId, x._id]));
  const hco = new Map(hc.map((x) => [x.courseCode, x._id]));
  await Preference.insertMany(hd.preferences.map((p) => ({
    student: hso.get(p.studentId), semesterId: p.semesterId, electiveGroup: p.electiveGroup,
    rankedCourseIds: p.courseCodes.map((c) => hco.get(c)), status: p.status, submittedAt: new Date(),
  })));

  const startedAt = Date.now();
  const pending = admin.post("/api/v1/allocations/run").send({ semesterId: HEAVY, algorithm: "optimized", includeTimetable: true }).then((r) => r);
  let runningDoc = null;
  for (let i = 0; i < 40 && !runningDoc; i++) {
    runningDoc = await AllocationRun.findOne({ semesterId: HEAVY, status: "running" }).lean();
    if (!runningDoc) await new Promise((r) => setTimeout(r, 100));
  }
  if (!runningDoc) {
    await pending;
    skip("cancel a long-running run", `the run finished in ${Date.now() - startedAt} ms, before it could be cancelled`);
  } else {
    const healthBusy = (await request(app).get("/health")).body;
    check("health: shows the run that is computing right now (activeRuns = 1)", healthBusy.activeRuns === 1, `activeRuns=${healthBusy.activeRuns}`);
    check("a large timetable run records the size advisory on the run",
      (runningDoc.inputWarnings?.messages ?? []).some((m) => /200 students.*timetable search can be/.test(m)));
    await new Promise((r) => setTimeout(r, 300));
    const cancelRes = await admin.post(`/api/v1/allocations/runs/${runningDoc._id}/cancel`);
    const orig = await pending;
    if (cancelRes.status === 409 && orig.status === 201) {
      skip("cancel a long-running run", "the run completed just before the cancel arrived");
    } else {
      check("cancel: admin cancel returns 200 and reports the worker stopped",
        cancelRes.status === 200 && cancelRes.body?.data?.workerStopped === true, `status ${cancelRes.status}`);
      check("cancel: the original request answers 409 ALLOCATION_CANCELLED",
        orig.status === 409 && orig.body?.error?.code === "ALLOCATION_CANCELLED", `status ${orig.status} after ${Date.now() - startedAt} ms`);
      const after = await AllocationRun.findById(runningDoc._id).lean();
      check("cancel: run stays 'cancelled' (not overwritten) with no assignments",
        after.status === "cancelled" && (await Allocation.countDocuments({ run: runningDoc._id })) === 0, `status=${after.status}`);
      check("cancel: a cancelled run can then be deleted",
        (await admin.del(`/api/v1/allocations/runs/${runningDoc._id}`)).status === 200);
    }
  }
} catch (err) {
  console.error("\nE2E aborted:", err);
  results.push({ name: "script completed", ok: false });
} finally {
  try {
    await mongoose.connection.dropDatabase();
    console.log(`\nDropped throwaway database "${dbName}".`);
  } catch (e) {
    console.error(`!! Could not drop "${dbName}": ${e.message} (delete it manually in Atlas)`);
  }
  await disconnectDB();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
}
