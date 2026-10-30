/**
 * scripts/seed.js - load a generated mock dataset into MongoDB.
 *
 *   node scripts/seed.js --scenario balanced --size small --semester SEM-SEED --seed 1 --reset --users
 *
 * Options
 *   --scenario  balanced | scarce-seats | many-ties | many-clashes   (default balanced)
 *   --size      small(30) | medium(200) | large(1000) | <integer>    (default small)
 *   --semester  semester id to create the data under                 (default SEM-SEED)
 *   --seed      integer; the same seed regenerates the same data     (default 1)
 *   --reset     first delete previously seeded data (only records with the SEED or SD- prefix) for that semester
 *   --users     also create a login per student (password from SEED_STUDENT_PASSWORD
 *               or a random one that is printed once)
 *
 * Safety: refuses to run when NODE_ENV=production. Reset only ever deletes
 * records created by this script (identifiable SEED / SD- prefixes).
 */

import { randomBytes } from "node:crypto";
import { env } from "../src/config/env.js";
import { connectDB, disconnectDB } from "../src/config/db.js";
import Student from "../src/models/Student.js";
import Course from "../src/models/Course.js";
import Preference from "../src/models/Preference.js";
import User from "../src/models/User.js";
import { hashPassword } from "../src/services/auth.service.js";
import { generateDataset, SCENARIOS, SIZES, seedEmail } from "../src/seed/generateDataset.js";

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

async function main() {
  if (env.isProduction) {
    throw new Error("Refusing to seed mock data when NODE_ENV=production.");
  }

  const args = parseArgs(process.argv.slice(2));
  const scenario = args.scenario ?? "balanced";
  const sizeArg = args.size ?? "small";
  const size = SIZES[sizeArg] ?? Number(sizeArg);
  const semesterId = args.semester ?? "SEM-SEED";
  const seed = args.seed === undefined ? 1 : Number(args.seed);

  if (!SCENARIOS.includes(scenario)) {
    throw new Error(`Unknown scenario "${scenario}". Use: ${SCENARIOS.join(", ")}`);
  }
  if (!Number.isInteger(size)) throw new Error("--size must be small|medium|large or an integer.");
  if (!Number.isInteger(seed) || seed < 0) throw new Error("--seed must be a non-negative integer.");

  const data = generateDataset({ scenario, size, semesterId, seed });

  await connectDB();
  try {
    if (args.reset) {
      const seededStudents = await Student.find({ semesterId, studentId: /^SEED/ }).select("_id").lean();
      const ids = seededStudents.map((s) => s._id);
      const delPrefs = await Preference.deleteMany({ student: { $in: ids } });
      const delUsers = await User.deleteMany({ student: { $in: ids }, email: /@seed\.local$/ });
      const delStudents = await Student.deleteMany({ _id: { $in: ids } });
      const delCourses = await Course.deleteMany({ semesterId, courseCode: /^SD-/ });
      console.log(
        `Reset: removed ${delStudents.deletedCount} students, ${delCourses.deletedCount} courses, ` +
          `${delPrefs.deletedCount} preferences, ${delUsers.deletedCount} users.`
      );
    }

    // Student ids (SEED0001...) are unique across the whole database, not per semester. Seeded
    // students left in ANOTHER semester (or in this one when --reset was not given) would make
    // the insert fail with a bare duplicate-key error, so say what to do instead.
    const existing = await Student.distinct("semesterId", { studentId: /^SEED/ });
    if (existing.length > 0) {
      const names = existing.map((s) => `"${s}"`).join(", ");
      throw new Error(
        `Seeded students already exist in semester ${names}, and student ids are unique across the database. ` +
          `Refresh that data with: node scripts/seed.js --semester ${existing[0]} --reset --users  (add your other options), ` +
          `or point MONGODB_URI at an empty database.`
      );
    }

    const students = await Student.insertMany(data.students);
    const courses = await Course.insertMany(data.courses);
    const studentOid = new Map(students.map((s) => [s.studentId, s._id]));
    const courseOid = new Map(courses.map((c) => [c.courseCode, c._id]));

    await Preference.insertMany(
      data.preferences.map((p) => ({
        student: studentOid.get(p.studentId),
        semesterId: p.semesterId,
        electiveGroup: p.electiveGroup,
        rankedCourseIds: p.courseCodes.map((code) => courseOid.get(code)),
        status: p.status,
        submittedAt: new Date(),
      }))
    );

    let password = null;
    if (args.users) {
      password = process.env.SEED_STUDENT_PASSWORD || randomBytes(9).toString("base64url");
      // one hash is reused for every seeded account (argon2 is deliberately slow)
      const passwordHash = await hashPassword(password);
      await User.insertMany(
        data.students.map((s) => ({
          email: seedEmail(s.studentId),
          passwordHash,
          role: "student",
          student: studentOid.get(s.studentId),
          isActive: true,
        }))
      );
    }

    console.log(`Seeded scenario "${scenario}" (${data.students.length} students, ${data.courses.length} courses, ${data.preferences.length} preference lists) for semester "${semesterId}", seed ${seed}.`);
    if (password) {
      console.log(`Student logins: ${seedEmail("SEED0001")} ... ${seedEmail("SEED" + String(size).padStart(4, "0"))}`);
      console.log(`Password (shown once): ${password}`);
    }
    console.log(`Next: POST /api/v1/allocations/run with { "semesterId": "${semesterId}", "algorithm": "baseline" | "optimized" }`);
  } finally {
    await disconnectDB();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
