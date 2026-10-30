/**
 * src/seed/generateDataset.js
 * Deterministic mock-data generator for allocation experiments. Pure (no
 * database): the same { scenario, size, semesterId, seed } always yields the
 * same dataset, so experiment results are reproducible.
 *
 * All generated identifiers are recognisable and safe to reset:
 *   students  SEED0001...   courses  SD-A1, SD-B3...   users  seed0001@seed.local
 *
 * Scenarios (what each stresses):
 *   balanced      seats ~ 1.2x students per group, mixed CGPAs, moderate clashes
 *   scarce-seats  seats ~ 0.6x students: heavy competition for every course
 *   many-ties     only four distinct CGPA values: exercises tie handling
 *   many-clashes  every course draws from only four time slots: timetable stress
 *
 * Mock data only: groups, sizes and capacities are assumptions for testing
 * the algorithms, not institutional rules.
 */

import { createSeededRandom } from "../../../algorithm/src/utils/seededRandom.js";

export const SCENARIOS = ["balanced", "scarce-seats", "many-ties", "many-clashes"];
export const SIZES = { small: 30, medium: 200, large: 1000 };
export const GROUPS = ["A", "B"];

const DEPARTMENTS = ["CSE", "ECE", "ME", "EE", "CE"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const HOURS = [8, 9, 10, 11, 14, 15, 16];

const pad = (n, w) => String(n).padStart(w, "0");
const hhmm = (h) => `${pad(h, 2)}:00`;

function slotPool(scenario) {
  const all = DAYS.flatMap((day) =>
    HOURS.map((h) => ({ day, start: hhmm(h), end: `${pad(h, 2)}:50` }))
  );
  // many-clashes: courses compete for just twelve slots (fewer makes the optimizer's
  // timetable search impractically slow even at 30 students; see README)
  return scenario === "many-clashes" ? all.slice(0, 12) : all;
}

/** Weighted shuffle (Efraimidis-Spirakis): higher weight tends to come first. */
function weightedOrder(items, weights, random) {
  return items
    .map((item, i) => ({ item, key: Math.pow(random(), 1 / weights[i]) }))
    .sort((a, b) => b.key - a.key)
    .map((x) => x.item);
}

export function generateDataset({
  scenario = "balanced",
  size = SIZES.small,
  semesterId = "SEM-SEED",
  seed = 1,
} = {}) {
  if (!SCENARIOS.includes(scenario)) {
    throw new Error(`Unknown scenario "${scenario}". Use one of: ${SCENARIOS.join(", ")}.`);
  }
  if (!Number.isInteger(size) || size < 4 || size > 5000) {
    throw new Error("size must be an integer between 4 and 5000.");
  }
  if (typeof semesterId !== "string" || !semesterId.trim()) {
    throw new Error("semesterId is required.");
  }

  const random = createSeededRandom(seed);
  const intIn = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));

  // ---- Courses: coursesPerGroup grows slowly with the class size ----------
  const coursesPerGroup = Math.min(10, Math.max(3, Math.ceil(size / 25) + 2));
  const seatFactor = { balanced: 1.2, "scarce-seats": 0.6, "many-ties": 0.9, "many-clashes": 1.2 }[scenario];
  const pool = slotPool(scenario);

  const courses = [];
  for (const group of GROUPS) {
    const perCourse = Math.max(1, Math.round((size * seatFactor) / coursesPerGroup));
    for (let i = 1; i <= coursesPerGroup; i++) {
      const slots = [];
      const wanted = random() < 0.5 ? 1 : 2;
      while (slots.length < wanted) {
        const s = pool[intIn(0, pool.length - 1)];
        if (!slots.some((x) => x.day === s.day && x.start === s.start)) slots.push({ ...s });
        if (slots.length >= pool.length) break;
      }
      courses.push({
        courseCode: `SD-${group}${i}`,
        title: `Seed ${group}${i}`,
        // +-25% variation so courses are not all identical
        capacity: Math.max(1, Math.round(perCourse * (0.75 + random() * 0.5))),
        semesterId,
        electiveGroup: group,
        timetableSlots: slots,
        isActive: true,
      });
    }
  }

  // ---- Students -------------------------------------------------------------
  const tieCgpas = [7.5, 8.0, 8.5, 9.0];
  const students = [];
  for (let i = 1; i <= size; i++) {
    const cgpa =
      scenario === "many-ties"
        ? tieCgpas[intIn(0, tieCgpas.length - 1)]
        : Math.round((5 + random() * 4.9) * 100) / 100;
    students.push({
      studentId: `SEED${pad(i, 4)}`,
      name: `Seed Student ${pad(i, 4)}`,
      cgpa,
      department: DEPARTMENTS[(i - 1) % DEPARTMENTS.length],
      semesterId,
      electiveGroups: [...GROUPS],
      isActive: true,
    });
  }

  // ---- Preferences: skewed popularity, up to 15 ranked courses per group ----
  const preferences = [];
  for (const group of GROUPS) {
    const groupCourses = courses.filter((c) => c.electiveGroup === group);
    // a few courses are much more popular than the rest
    const weights = groupCourses.map((_, i) => 1 / (1 + i * 0.6));
    for (const s of students) {
      const listLength = Math.min(groupCourses.length, 15, intIn(2, groupCourses.length));
      const ordered = weightedOrder(groupCourses, weights, random).slice(0, listLength);
      preferences.push({
        studentId: s.studentId,
        semesterId,
        electiveGroup: group,
        courseCodes: ordered.map((c) => c.courseCode),
        status: "submitted",
      });
    }
  }

  return {
    meta: { scenario, size, semesterId, seed, coursesPerGroup },
    students,
    courses,
    preferences,
  };
}

/** Email used for the login linked to a generated student. */
export const seedEmail = (studentId) => `${studentId.toLowerCase()}@seed.local`;
