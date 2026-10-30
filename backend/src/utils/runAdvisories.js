/**
 * src/utils/runAdvisories.js
 * Advisory (never blocking) messages recorded on a run's inputWarnings.
 */

/**
 * With the timetable check on, the optimizer's conflict search is data
 * dependent and can take very long on large inputs (measured: about a second
 * to over a minute at 200 students). A run stopped by the time limit is
 * recorded as failed, so large runs are flagged up front.
 */
export const LARGE_TIMETABLE_RUN_STUDENTS = 150;

/**
 * @returns {string|null} a warning message, or null when no advice is needed
 */
export function largeTimetableRunWarning({ studentCount, includeTimetable, includesOptimizer }) {
  if (!includeTimetable || !includesOptimizer) return null;
  if (!Number.isFinite(studentCount) || studentCount < LARGE_TIMETABLE_RUN_STUDENTS) return null;
  return (
    `This run has ${studentCount} students with timetable checking on. The optimizer's timetable search can be ` +
    "very slow on large inputs; a run that exceeds the time limit is stopped and recorded as failed. " +
    "If that happens, retry with includeTimetable=false (and note that results are then not timetable-checked)."
  );
}
