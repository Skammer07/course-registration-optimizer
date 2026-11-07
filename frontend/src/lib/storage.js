/**
 * Tiny convenience memory in the browser (never required for anything to work: private
 * windows and blocked storage simply mean nothing is remembered).
 */

const LAST_SEMESTER = "course-allocation:last-semester";

export function readLastSemester() {
  try {
    return window.localStorage.getItem(LAST_SEMESTER);
  } catch {
    return null;
  }
}

export function rememberSemester(semesterId) {
  try {
    window.localStorage.setItem(LAST_SEMESTER, semesterId);
  } catch {
    /* not available: fine */
  }
}
