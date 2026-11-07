/**
 * scripts/seed-realistic.js - load several realistic semesters into MongoDB (see src/seed/generateRealistic.js).
 *
 *   node scripts/seed-realistic.js --semesters SEM-1:500,SEM-2:1000,SEM-3:1500 --seed 11 \
 *        --wipe --backup ../data/backups/before-realistic --yes
 *
 * Options
 *   --semesters  comma list of  <semesterId>:<students>[:<seatFactor>]   (required)
 *   --seed       integer; the same seed regenerates the same data           (default 11)
 *   --wipe       FIRST delete all data except admin and faculty accounts: students, courses, preferences,
 *                semesters, allocation runs, allocations and student logins. Needs --backup and --yes.
 *   --replace    delete the data of ONLY the semesters listed in --semesters (students, their logins and lists,
 *                courses, the semester, its runs and allocations) before loading them again. Other semesters
 *                and all admin / faculty accounts stay. Needs --backup and --yes.
 *   --backup     folder: before wiping, every collection is saved there as JSON (nothing is deleted if this fails)
 *   --yes        confirms --wipe (it cannot be undone except from the backup)
 *   --no-users   do not create a login per student
 *   --student-offset / --course-offset / --compulsory-offset
 *                numbers already used by semesters in the database, so a semester can be ADDED without a wipe
 *                (e.g. after 500 students and 30 + 12 courses: 500, 30 and 12). Default 0.
 *
 * Student logins: iitism0001@seed.local ... (password from SEED_STUDENT_PASSWORD, or a random one printed once).
 * Refuses to run when NODE_ENV=production.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import mongoose from "mongoose";
import { env } from "../src/config/env.js";
import { connectDB, disconnectDB } from "../src/config/db.js";
import Student from "../src/models/Student.js";
import Course from "../src/models/Course.js";
import Preference from "../src/models/Preference.js";
import Semester from "../src/models/Semester.js";
import User from "../src/models/User.js";
import Allocation from "../src/models/Allocation.js";
import AllocationRun from "../src/models/AllocationRun.js";
import { hashPassword } from "../src/services/auth.service.js";
import { generateRealistic, realisticEmail } from "../src/seed/generateRealistic.js";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function parseSemesters(text) {
  if (typeof text !== "string" || !text) throw new Error("--semesters is required, e.g. SEM-1:500,SEM-2:1000");
  return text.split(",").map((part) => {
    const [semesterId, size, seatFactor] = part.split(":");
    if (!semesterId || !Number.isInteger(Number(size))) {
      throw new Error(`Bad semester "${part}". Use <id>:<students>[:<seatFactor>].`);
    }
    return { semesterId: semesterId.trim(), size: Number(size), seatFactor: seatFactor ? Number(seatFactor) : undefined };
  });
}

async function backupAll(dir) {
  mkdirSync(dir, { recursive: true });
  const db = mongoose.connection.db;
  const summary = {};
  for (const { name } of await db.listCollections().toArray()) {
    const docs = await db.collection(name).find({}).toArray();
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(docs));
    summary[name] = docs.length;
  }
  return summary;
}

async function main() {
  if (env.isProduction) throw new Error("Refusing to seed mock data when NODE_ENV=production.");
  const args = parseArgs(process.argv.slice(2));
  const plan = parseSemesters(args.semesters);
  const seed = args.seed === undefined ? 11 : Number(args.seed);
  if (!Number.isInteger(seed) || seed < 0) throw new Error("--seed must be a non-negative integer.");
  if ((args.wipe || args.replace) && (!args.backup || args.backup === true || !args.yes)) {
    throw new Error("--wipe and --replace need --backup <folder> and --yes (they delete data).");
  }

  // Generate everything first, so a bad option fails before anything is touched. Numbering continues
  // from one semester to the next (student ids are unique across the whole database), while every
  // semester gets its own set of courses.
  const datasets = [];
  let studentOffset = Number(args["student-offset"] ?? 0);
  let courseOffset = Number(args["course-offset"] ?? 0);
  let compulsoryOffset = Number(args["compulsory-offset"] ?? 0);
  for (const v of [studentOffset, courseOffset, compulsoryOffset]) {
    if (!Number.isInteger(v) || v < 0) throw new Error("Offsets must be non-negative integers.");
  }
  for (const p of plan) {
    const data = generateRealistic({ ...p, seed, studentOffset, courseOffset, compulsoryOffset });
    datasets.push(data);
    studentOffset += data.students.length;
    courseOffset += data.meta.openElectives;
    compulsoryOffset += data.meta.compulsoryCourses;
  }

  await connectDB();
  try {
    if (args.wipe) {
      const saved = await backupAll(args.backup);
      console.log(`Backup written to ${args.backup}:`, JSON.stringify(saved));
      const removed = {
        allocations: (await Allocation.deleteMany({})).deletedCount,
        allocationRuns: (await AllocationRun.deleteMany({})).deletedCount,
        preferences: (await Preference.deleteMany({})).deletedCount,
        students: (await Student.deleteMany({})).deletedCount,
        courses: (await Course.deleteMany({})).deletedCount,
        semesters: (await Semester.deleteMany({})).deletedCount,
        studentLogins: (await User.deleteMany({ role: "student" })).deletedCount,
      };
      console.log("Deleted:", JSON.stringify(removed));
    }

    if (args.replace && !args.wipe) {
      const saved = await backupAll(args.backup);
      console.log(`Backup written to ${args.backup}:`, JSON.stringify(saved));
      for (const { semesterId } of plan) {
        const runIds = (await AllocationRun.find({ semesterId }).select("_id").lean()).map((r) => r._id);
        const studentIds = (await Student.find({ semesterId }).select("_id").lean()).map((x) => x._id);
        const removed = {
          allocations: (await Allocation.deleteMany({ run: { $in: runIds } })).deletedCount,
          allocationRuns: (await AllocationRun.deleteMany({ semesterId })).deletedCount,
          preferences: (await Preference.deleteMany({ $or: [{ semesterId }, { student: { $in: studentIds } }] })).deletedCount,
          studentLogins: (await User.deleteMany({ role: "student", student: { $in: studentIds } })).deletedCount,
          students: (await Student.deleteMany({ semesterId })).deletedCount,
          courses: (await Course.deleteMany({ semesterId })).deletedCount,
          semesters: (await Semester.deleteMany({ semesterId })).deletedCount,
        };
        console.log(`Replaced ${semesterId}, deleted:`, JSON.stringify(removed));
      }
    }

    const firstIds = datasets.map((d) => d.students[0].studentId);
    if ((await Student.countDocuments({ studentId: { $in: firstIds } })) > 0) {
      throw new Error("Students with these ids already exist. Use --wipe (with --backup and --yes), or other semester ids.");
    }

    let password = null;
    let passwordHash = null;
    if (!args["no-users"]) {
      password = process.env.SEED_STUDENT_PASSWORD || randomBytes(9).toString("base64url");
      passwordHash = await hashPassword(password); // one hash for every account (argon2 is slow on purpose)
    }

    for (const data of datasets) {
      const { semesterId } = data.meta;
      await Semester.create({ semesterId, name: `Semester ${semesterId}` });
      const students = await Student.insertMany(data.students, { ordered: false });
      const courses = await Course.insertMany(data.courses, { ordered: false });
      const studentOid = new Map(students.map((s) => [s.studentId, s._id]));
      const courseOid = new Map(courses.map((c) => [c.courseCode, c._id]));
      const now = new Date();
      await Preference.insertMany(
        data.preferences.map((p) => ({
          student: studentOid.get(p.studentId),
          semesterId,
          electiveGroup: p.electiveGroup,
          rankedCourseIds: p.courseCodes.map((code) => courseOid.get(code)),
          status: p.status,
          submittedAt: p.status === "submitted" ? now : null,
        })),
        { ordered: false }
      );
      if (passwordHash) {
        await User.insertMany(
          data.students.map((s) => ({
            email: realisticEmail(s.studentId),
            passwordHash,
            role: "student",
            student: studentOid.get(s.studentId),
            isActive: true,
          })),
          { ordered: false }
        );
      }
      const m = data.meta;
      const submitted = data.preferences.filter((p) => p.status === "submitted").length;
      console.log(
        `${semesterId}: ${data.students.length} students (${m.firstStudent} to ${m.lastStudent}), ` +
          `${m.openElectives} open electives ${m.firstCourse} to ${m.lastCourse} (${m.totalSeats} seats, factor ${m.seatFactor}), ` +
          `${m.compulsoryCourses} compulsory courses, ` +
          `${data.preferences.length} preference lists (${submitted} submitted).`
      );
    }

    if (password) {
      console.log(`Student logins: ${realisticEmail(datasets[0].students[0].studentId)} ... (one per student)`);
      console.log(`Password (shown once): ${password}`);
    }
  } finally {
    await disconnectDB();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
