/**
 * src/services/semester.service.js
 * Semester records and the preference window (deadlines).
 *
 * STATUS values returned to the UI:
 *   preferences-not-open  window has not started yet
 *   preferences-open      students may edit/submit preferences
 *   allocation-pending    preferences closed, nothing published yet
 *   results-published     a run is published for the semester
 * A semester with no record is treated as "preferences open".
 */

import Semester from "../models/Semester.js";
import Student from "../models/Student.js";
import Course from "../models/Course.js";
import Preference from "../models/Preference.js";
import AllocationRun from "../models/AllocationRun.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../utils/logger.js";
import { getPublishedRunInfo } from "./publishedResults.service.js";

/**
 * Pure: is the preference window open for this semester record at `now`?
 * @returns {{ open: boolean, phase: "open"|"not-open"|"closed", source: "default"|"override"|"dates" }}
 */
export function computePreferenceWindow(semester, now = new Date()) {
  if (!semester) return { open: true, phase: "open", source: "default" };

  if (semester.preferencesOverride === "open") return { open: true, phase: "open", source: "override" };
  if (semester.preferencesOverride === "closed") return { open: false, phase: "closed", source: "override" };

  const openAt = semester.preferencesOpenAt ? new Date(semester.preferencesOpenAt) : null;
  const closeAt = semester.preferencesCloseAt ? new Date(semester.preferencesCloseAt) : null;
  if (openAt && now < openAt) return { open: false, phase: "not-open", source: "dates" };
  if (closeAt && now >= closeAt) return { open: false, phase: "closed", source: "dates" };
  return { open: true, phase: "open", source: "dates" };
}

export async function getSemester(semesterId) {
  return Semester.findOne({ semesterId }).lean();
}

/** Throws 403 PREFERENCES_CLOSED unless preferences are currently open. */
export async function assertPreferencesOpen(semesterId) {
  const semester = await getSemester(semesterId);
  const window = computePreferenceWindow(semester);
  if (window.open) return;
  const message =
    window.phase === "not-open"
      ? `Preferences for semester "${semesterId}" are not open yet.`
      : `Preferences for semester "${semesterId}" are closed.`;
  throw new ApiError(403, message, "PREFERENCES_CLOSED");
}

/** A warning message when a run starts while preferences are still open, else null. */
export async function preferenceWindowWarning(semesterId) {
  const semester = await getSemester(semesterId);
  if (semester && computePreferenceWindow(semester).open) {
    return "Preferences are still open for this semester; students may change them after this run.";
  }
  return null;
}

/** Status for the UI banner. */
export async function getSemesterStatus(semesterId) {
  const [semester, published] = await Promise.all([
    getSemester(semesterId),
    getPublishedRunInfo(semesterId),
  ]);
  const window = computePreferenceWindow(semester);

  let status;
  if (published.published) status = "results-published";
  else if (window.phase === "not-open") status = "preferences-not-open";
  else if (window.open) status = "preferences-open";
  else status = "allocation-pending";

  return {
    semesterId,
    status,
    recordExists: Boolean(semester),
    preferencesOpen: window.open,
    opensAt: semester?.preferencesOpenAt ?? null,
    closesAt: semester?.preferencesCloseAt ?? null,
    override: semester?.preferencesOverride ?? null,
    resultsPublished: published.published,
    publishedRun: published.run,
  };
}

export async function listSemesters() {
  return Semester.find({}).sort({ semesterId: 1 }).lean();
}

/**
 * Every semester the system knows about, with what it holds, so a screen can offer a list
 * instead of asking someone to type an id. A semester appears if it has an admin record, active
 * students, active courses, submitted preferences or any run; data entered through the seed
 * script or CSV imports has no record, so records alone would miss it.
 *
 * @returns {Promise<{ semesterId: string, name: string, recordExists: boolean, students: number,
 *   courses: number, preferenceLists: number, runs: number, published: boolean }[]>}
 */
export async function listSemesterOverview() {
  const countBy = (Model, match) =>
    Model.aggregate([{ $match: match }, { $group: { _id: "$semesterId", n: { $sum: 1 } } }]);

  const [students, courses, preferences, runs, records] = await Promise.all([
    countBy(Student, { isActive: true }),
    countBy(Course, { isActive: true }),
    countBy(Preference, { status: "submitted" }),
    AllocationRun.aggregate([
      {
        $group: {
          _id: "$semesterId",
          n: { $sum: 1 },
          published: { $sum: { $cond: [{ $eq: ["$status", "published"] }, 1, 0] } },
        },
      },
    ]),
    Semester.find({}).select("semesterId name").lean(),
  ]);

  const byId = new Map();
  const entry = (id) => {
    if (!byId.has(id)) {
      byId.set(id, { semesterId: id, name: "", recordExists: false, students: 0, courses: 0, preferenceLists: 0, runs: 0, published: false });
    }
    return byId.get(id);
  };
  const valid = (row) => typeof row._id === "string" && row._id.trim() !== "";

  for (const r of students.filter(valid)) entry(r._id).students = r.n;
  for (const r of courses.filter(valid)) entry(r._id).courses = r.n;
  for (const r of preferences.filter(valid)) entry(r._id).preferenceLists = r.n;
  for (const r of runs.filter(valid)) {
    const e = entry(r._id);
    e.runs = r.n;
    e.published = r.published > 0;
  }
  for (const r of records) {
    const e = entry(r.semesterId);
    e.recordExists = true;
    e.name = r.name ?? "";
  }

  // semesters that actually hold data first, then by id
  return [...byId.values()].sort(
    (a, b) => Number(b.students > 0) - Number(a.students > 0) || a.semesterId.localeCompare(b.semesterId)
  );
}

export async function createSemester(data) {
  try {
    const doc = await Semester.create(data);
    return doc.toObject();
  } catch (err) {
    if (err?.code === 11000) throw ApiError.conflict(`Semester "${data.semesterId}" already exists.`);
    if (err?.name === "ValidationError") throw ApiError.validation(err.message);
    throw err;
  }
}

export async function updateSemester(semesterId, data) {
  const doc = await Semester.findOne({ semesterId });
  if (!doc) throw ApiError.notFound("Semester");
  Object.assign(doc, data);
  try {
    await doc.save();
  } catch (err) {
    if (err?.name === "ValidationError") throw ApiError.validation(err.message);
    throw err;
  }
  return doc.toObject();
}

/**
 * Admin switch: "open" and "closed" force the state, "auto" returns control to
 * the dates. Creates the record if the semester has none yet.
 */
export async function setPreferencesState(semesterId, state) {
  const override = state === "auto" ? null : state;
  return Semester.findOneAndUpdate(
    { semesterId },
    { $set: { preferencesOverride: override }, $setOnInsert: { semesterId } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
}

/** Called after a run is published: close preferences. Never fails the publish. */
export async function closePreferencesAfterPublish(semesterId) {
  try {
    await Semester.updateOne(
      { semesterId },
      { $set: { preferencesOverride: "closed" }, $setOnInsert: { semesterId } },
      { upsert: true }
    );
  } catch (err) {
    logger.error({ semesterId, err: err.message }, "Could not close preferences after publish");
  }
}
