/**
 * src/utils/courseKind.js
 * One definition of the course kinds and the rules that go with them, shared by
 * the Mongoose model, the request schemas, the service layer and CSV import.
 *
 *   elective    chosen by students and allocated by the algorithms
 *   compulsory  never allocated; its timetable slots block overlapping electives
 *               for every student whose department is listed in `departments`
 */

export const COURSE_KINDS = ["elective", "compulsory"];

/** Trim, drop blanks, and remove duplicates (case-insensitive), keeping first spelling. */
export function cleanDepartments(value) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const dept = String(raw ?? "").trim();
    const key = dept.toLowerCase();
    if (dept && !seen.has(key)) {
      seen.add(key);
      out.push(dept);
    }
  }
  return out;
}

/**
 * Returns a message when the combination of fields is not allowed, otherwise null.
 * Works on plain objects, so it can check a merged update before it is saved.
 */
export function courseKindProblem({ kind = "elective", electiveGroup = null, departments = [] } = {}) {
  if (!COURSE_KINDS.includes(kind)) {
    return `kind must be one of: ${COURSE_KINDS.join(", ")}.`;
  }
  if (kind === "compulsory") {
    if (electiveGroup) {
      return "A compulsory course cannot belong to an elective group.";
    }
    if (cleanDepartments(departments).length === 0) {
      return "A compulsory course needs at least one department.";
    }
  }
  return null;
}

export const normalizeDepartment = (value) => String(value ?? "").trim().toLowerCase();

/**
 * The compulsory courses a student of `department` takes: those whose
 * `departments` include it (compared ignoring case and spacing). This is the one
 * rule used both to build the algorithm's fixed timetable and to show a student
 * their own compulsory courses.
 */
export function compulsoryCoursesForDepartment(courses, department) {
  const wanted = normalizeDepartment(department);
  if (!wanted) return [];
  return courses.filter(
    (course) =>
      course.kind === "compulsory" &&
      (course.departments ?? []).some((d) => normalizeDepartment(d) === wanted)
  );
}
