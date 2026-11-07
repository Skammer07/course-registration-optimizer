import { request } from "./client.js";

const api = "/api/v1";

// ---- courses -----------------------------------------------------------------------
/** One page of courses (the screens ask for up to 200). Filters: semesterId, electiveGroup, search, isActive. */
export const listCourses = (query) => request(`${api}/courses`, { query });
/** The signed-in student's own compulsory courses (code, title, weekly times). */
export const getMyCompulsory = () => request(`${api}/courses/my-compulsory`);
export const createCourse = (body) => request(`${api}/courses`, { method: "POST", body }).then((d) => d.course);
export const updateCourse = (id, body) =>
  request(`${api}/courses/${encodeURIComponent(id)}`, { method: "PATCH", body }).then((d) => d.course);

/** How many students ranked each course of a semester (submitted lists only). */
export const getCourseDemand = (semesterId) => request(`${api}/semesters/${encodeURIComponent(semesterId)}/demand`);

// ---- students ----------------------------------------------------------------------------
/** Students of a semester with their submission status per elective group, plus totals. */
export const getPreferenceOverview = (query) => request(`${api}/preferences/overview`, { query });
export const getStudent = (id) => request(`${api}/students/${encodeURIComponent(id)}`).then((d) => d.student);
export const createStudent = (body) => request(`${api}/students`, { method: "POST", body }).then((d) => d.student);
export const updateStudent = (id, body) =>
  request(`${api}/students/${encodeURIComponent(id)}`, { method: "PATCH", body }).then((d) => d.student);

/** One student's preference lists, each with its ranked courses populated. */
export const listStudentPreferences = ({ student, semesterId }) =>
  request(`${api}/preferences`, { query: { student, semesterId, limit: 50 } }).then((d) => d.preferences);

// ---- CSV import (admin) ----------------------------------------------------------------------
/**
 * @param {"students"|"courses"|"preferences"} type
 * @param {string} csv  the file contents
 * @param {{ dryRun?: boolean, onExisting?: "skip"|"update", createLogins?: boolean, status?: "draft"|"submitted" }} options
 */
export const importCsv = (type, csv, { dryRun = false, onExisting = "skip", createLogins, status } = {}) =>
  request(`${api}/imports/${type}`, {
    method: "POST",
    textBody: csv,
    query: {
      dryRun,
      onExisting,
      ...(type === "students" ? { createLogins: Boolean(createLogins) } : {}),
      ...(type === "preferences" && status ? { status } : {}),
    },
  });
