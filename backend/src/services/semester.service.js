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
