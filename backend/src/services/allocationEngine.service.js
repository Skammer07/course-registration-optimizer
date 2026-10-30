/**
 * src/services/allocationEngine.service.js
 *
 * Integrates the existing algorithm module without duplicating its logic.
 *
 * The algorithm expects:
 *   students:    [{ id: string, name: string, cgpa: number }]
 *   courses:     [{ id: string, name: string, capacity: number }]
 *   preferences: [{ studentId: string, courseId: string, rank: number }]
 *   timetable:   { [courseId]: [{ day, start, end }] }  (optional)
 *
 * The backend stores students with studentId, courses with courseCode.
 * This service normalizes Mongoose documents into the algorithm's format.
 *
 * IMPORTANT LIMITATIONS (documented, not hidden):
 * - The optimizer maximizes assignments and then minimizes preference-rank cost.
 * - It does NOT enforce strict CGPA priority ordering.
 * - It does NOT enforce elective-group-specific quotas. Group identity IS
 *   preserved on every normalized course/preference record (electiveGroup),
 *   and the publication check verifies each assignment against it, but the
 *   optimizer itself is group-agnostic (a group-aware objective would need a
 *   redesign and confirmed institutional policy).
 * - Institutional allocation policy has not been formally confirmed.
 * - See docs/allocation-rules.md for open questions.
 */

import path from "node:path";
import { createHash } from "node:crypto";
import { ApiError } from "../utils/ApiError.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

// -- Resolve the algorithm package path ---------------------------------------
// The algorithm lives at ../../algorithm relative to this file.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const algorithmRoot = path.resolve(__dirname, "../../../algorithm");

/**
 * Dynamic import of an algorithm module. A file:// URL is required: plain
 * Node ESM rejects absolute Windows paths ("C:\...") with
 * ERR_UNSUPPORTED_ESM_URL_SCHEME (test runners tolerate them, the server does not).
 */
async function importAlgorithm(relativePath) {
  const file = path.join(algorithmRoot, relativePath);
  try {
    return await import(pathToFileURL(file).href);
  } catch (err) {
    // Test runners (vitest) resolve plain paths but not file:// URLs here.
    // Only a failure to LOAD the module triggers the fallback.
    if (err?.code === "ERR_MODULE_NOT_FOUND" || /Failed to load url|Cannot find module/i.test(String(err?.message))) {
      return import(file);
    }
    throw err;
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;
const workerFile = new URL("./algorithmWorker.js", import.meta.url);

/**
 * Run an algorithm call in a worker thread with a time limit. The optimizer's
 * timetable conflict search can take very long on clash-heavy data; running it
 * synchronously would freeze every other request. On timeout the worker is
 * terminated and the promise rejects with code ALLOCATION_TIMEOUT.
 * Limit: ALLOCATION_TIMEOUT_MS (default 60000).
 */
function runInWorker(kind, input, options) {
  const limit = Number(process.env.ALLOCATION_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerFile, {
      workerData: { kind, algorithmRoot, input, options },
    });
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      fn(value);
    };
    const timer = setTimeout(() => {
      const err = new Error(`The allocation exceeded the time limit of ${limit} ms and was stopped.`);
      err.code = "ALLOCATION_TIMEOUT";
      finish(reject, err);
    }, limit);
    worker.once("message", (m) => (m.ok ? finish(resolve, m.result) : finish(reject, new Error(m.error))));
    worker.once("error", (e) => finish(reject, e));
    worker.once("exit", (code) => finish(reject, new Error(`Allocation worker exited unexpectedly (code ${code}).`)));
  });
}

// Dynamically import the comparison service using its real path.
// We use a dynamic import so the module can be mocked in unit tests.
let _comparisonService = null;

async function getComparisonService() {
  if (_comparisonService) return _comparisonService;
  const mod = await importAlgorithm("src/services/allocationComparisonService.js");
  _comparisonService = mod;
  return _comparisonService;
}

let _singleService = null;
let _comparisonOverridden = false;
let _singleOverridden = false;

async function getSingleService() {
  if (_singleService) return _singleService;
  _singleService = await importAlgorithm("src/services/singleAllocationService.js");
  return _singleService;
}

/** Override the single-algorithm service (tests). */
export function _overrideSingleService(mock) {
  _singleService = mock;
  _singleOverridden = Boolean(mock);
}

/**
 * Override the comparison service (used in tests to inject a mock).
 * @param {object} mock  Object with runAllocationComparison function
 */
export function _overrideComparisonService(mock) {
  _comparisonService = mock;
  _comparisonOverridden = Boolean(mock);
}

let _validator = null;

/**
 * The algorithm's own validateAllocation: the single shared definition of the
 * mandatory constraints, used for both baseline and optimized results (at run
 * time and again before publication).
 */
export async function getAllocationValidator() {
  if (_validator) return _validator;
  const mod = await importAlgorithm("src/validation/validateAllocation.js");
  _validator = mod.validateAllocation;
  return _validator;
}

/**
 * Convert Mongoose Student documents to algorithm input format.
 * @param {object[]} students  Lean Mongoose Student documents
 * @returns {{ id: string, name: string, cgpa: number }[]}
 */
export function normalizeStudents(students) {
  return students.map((s) => ({
    id: s.studentId,
    name: s.name,
    cgpa: s.cgpa,
  }));
}

/**
 * Convert Mongoose Course documents to algorithm input format.
 * @param {object[]} courses  Lean Mongoose Course documents
 * @returns {{ id: string, name: string, capacity: number, electiveGroup: string|null }[]}
 */
export function normalizeCourses(courses) {
  return courses.map((c) => ({
    id: c.courseCode,
    name: c.title,
    capacity: c.capacity,
    // Group identity is preserved (extra field; the algorithms ignore it).
    electiveGroup: c.electiveGroup ?? null,
  }));
}

/**
 * Convert Mongoose Course documents to a timetable map.
 * @param {object[]} courses  Lean Mongoose Course documents
 * @returns {object|null}  { [courseCode]: [{ day, start, end }] } or null
 */
export function buildTimetableMap(courses) {
  const hasTimetable = courses.some(
    (c) => c.timetableSlots && c.timetableSlots.length > 0
  );

  if (!hasTimetable) return null;

  const timetable = {};
  for (const course of courses) {
    if (course.timetableSlots && course.timetableSlots.length > 0) {
      timetable[course.courseCode] = course.timetableSlots.map((slot) => ({
        day: slot.day,
        start: slot.start,
        end: slot.end,
      }));
    }
  }
  return timetable;
}

/**
 * Convert Mongoose Preference documents (grouped, ranked) into the flat
 * { studentId, courseId, rank, electiveGroup } format used by the algorithm.
 *
 * Each Preference document stores rankedCourseIds as an ordered array.
 * Index 0 -> rank 1, index 1 -> rank 2, etc. The elective group of the list
 * is carried on every flat record so group identity is not lost.
 *
 * @param {object[]} preferences  Populated Mongoose Preference documents
 *   Each must have: student.studentId and rankedCourseIds[].courseCode
 * @returns {{ studentId: string, courseId: string, rank: number, electiveGroup: string|null }[]}
 */
export function normalizePreferences(preferences) {
  const flat = [];

  for (const pref of preferences) {
    const studentId = pref.student?.studentId ?? pref.studentId;

    if (!studentId) continue;

    for (let i = 0; i < pref.rankedCourseIds.length; i++) {
      const course = pref.rankedCourseIds[i];
      const courseId = course?.courseCode ?? course?.toString?.() ?? null;

      if (!courseId) continue;

      flat.push({
        studentId,
        courseId,
        rank: i + 1,
        electiveGroup: pref.electiveGroup ?? course?.electiveGroup ?? null,
      });
    }
  }

  return flat;
}

/**
 * Prepare database documents for a run, BEFORE the algorithm sees them.
 *
 * Preferences are loaded for the whole semester, but only active students and
 * active courses take part. Without this step a single stale record (a
 * deactivated student, a course withdrawn after submission) makes the whole
 * run throw. Unusable records are skipped and REPORTED (never silent):
 *   - a preference list whose student is not active in the run is skipped;
 *   - ranked courses that are not active in the run are dropped, and the
 *     remaining courses keep their relative order (ranks close the gap);
 *   - a list left with no courses is skipped.
 * Throws 400 (no run is created) when the timetable is only partly filled in
 * or nothing usable remains.
 *
 * @returns {{ preferences: object[], warnings: { skippedPreferences: number,
 *   droppedCourseEntries: number, messages: string[] } }}
 */
export function prepareInputs({ students, courses, preferences, includeTimetable = true }) {
  if (includeTimetable) {
    const missing = courses.filter((c) => !c.timetableSlots || c.timetableSlots.length === 0);
    if (missing.length > 0 && missing.length < courses.length) {
      const shown = missing.slice(0, 10).map((c) => c.courseCode).join(", ");
      throw ApiError.badRequest(
        `Timetable validation needs timetable slots on every active course. Missing for: ${shown}` +
          `${missing.length > 10 ? ` (+${missing.length - 10} more)` : ""}. ` +
          "Add the slots or run with includeTimetable=false."
      );
    }
  }

  const activeStudents = new Set(students.map((s) => s.studentId));
  const activeCourses = new Set(courses.map((c) => c.courseCode));
  const messages = [];
  let skippedPreferences = 0;
  let droppedCourseEntries = 0;
  const usable = [];

  for (const pref of preferences) {
    const sid = pref.student?.studentId;
    if (!sid || !activeStudents.has(sid)) {
      skippedPreferences++;
      messages.push(`Skipped a preference list: student "${sid ?? "unknown"}" is not active in this semester.`);
      continue;
    }
    const all = pref.rankedCourseIds ?? [];
    const kept = all.filter((c) => c && activeCourses.has(c.courseCode));
    const dropped = all.length - kept.length;
    droppedCourseEntries += dropped;
    if (dropped > 0) {
      messages.push(`Student "${sid}" (group ${pref.electiveGroup ?? "?"}): ${dropped} ranked course(s) not active in this semester were dropped.`);
    }
    if (kept.length === 0) {
      skippedPreferences++;
      messages.push(`Skipped a preference list for student "${sid}": no active courses remained.`);
      continue;
    }
    usable.push({ ...pref, rankedCourseIds: kept });
  }

  if (usable.length === 0) {
    throw ApiError.badRequest("No usable submitted preferences remain after excluding inactive students and courses.");
  }

  return {
    preferences: usable,
    warnings: { skippedPreferences, droppedCourseEntries, messages: messages.slice(0, 20) },
  };
}

/**
 * Order-independent SHA-256 of the normalized input, so two runs over the same
 * data get the same fingerprint regardless of database return order.
 */
export function fingerprintInput({ algStudents, algCourses, algPreferences, timetable }) {
  const by = (k) => (a, b) => String(a[k]).localeCompare(String(b[k]));
  const canonical = {
    students: [...algStudents].sort(by("id")),
    courses: [...algCourses].sort(by("id")),
    preferences: [...algPreferences].sort(
      (a, b) =>
        a.studentId.localeCompare(b.studentId) || a.courseId.localeCompare(b.courseId)
    ),
    timetable: timetable
      ? Object.fromEntries(Object.entries(timetable).sort(([x], [y]) => x.localeCompare(y)))
      : null,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function buildInput({ students, courses, preferences, includeTimetable }) {
  const algStudents = normalizeStudents(students);
  const algCourses = normalizeCourses(courses);
  const algPreferences = normalizePreferences(preferences);
  const timetable = includeTimetable ? buildTimetableMap(courses) : null;
  return { algStudents, algCourses, algPreferences, timetable };
}

function buildOptions(options) {
  return {
    maxCoursesPerStudent: options.maxCoursesPerStudent ?? 2,
    meritRatio: options.meritRatio ?? 0.75,
    randomRatio: options.randomRatio ?? 0.25,
    // undefined -> the algorithm generates a seed and reports it back
    seed: options.seed,
  };
}

/**
 * Run the allocation comparison (both algorithms) using the real algorithm module.
 *
 * @param {object} params
 * @param {object[]} params.students   Lean Mongoose Student docs
 * @param {object[]} params.courses    Lean Mongoose Course docs
 * @param {object[]} params.preferences Populated Mongoose Preference docs
 * @param {boolean}  params.includeTimetable
 * @param {object}   params.options   maxCoursesPerStudent, meritRatio, randomRatio, seed
 * @returns {Promise<object>} Result from runAllocationComparison
 */
export async function runComparison({
  students,
  courses,
  preferences,
  includeTimetable = true,
  options = {},
}) {
  const snapshot = buildInput({ students, courses, preferences, includeTimetable });
  const input = {
    students: snapshot.algStudents,
    courses: snapshot.algCourses,
    preferences: snapshot.algPreferences,
    timetable: snapshot.timetable,
  };

  // The algorithm receives its own deep copy (structured clone) so it can
  // never mutate the objects later stored as the immutable run snapshot.
  let result;
  if (_comparisonOverridden) {
    const { runAllocationComparison } = await getComparisonService();
    result = runAllocationComparison(structuredClone(input), buildOptions(options));
  } else {
    result = await runInWorker("comparison", input, buildOptions(options));
  }

  return { result, inputSnapshot: snapshot };
}

/**
 * Run ONE selected algorithm ("baseline" or "optimized").
 * Returns { result, inputSnapshot } where result has the shape of
 * runSingleAllocation (allocations, metrics, runtimeMs, validation, configuration).
 */
export async function runSingle({
  algorithm,
  students,
  courses,
  preferences,
  includeTimetable = true,
  options = {},
}) {
  const snapshot = buildInput({ students, courses, preferences, includeTimetable });
  const input = {
    students: snapshot.algStudents,
    courses: snapshot.algCourses,
    preferences: snapshot.algPreferences,
    timetable: snapshot.timetable,
  };

  const singleOptions = { ...buildOptions(options), algorithm };
  let result;
  if (_singleOverridden) {
    const { runSingleAllocation } = await getSingleService();
    result = runSingleAllocation(structuredClone(input), singleOptions);
  } else {
    result = await runInWorker("single", input, singleOptions);
  }

  return { result, inputSnapshot: snapshot };
}
