/**
 * What each CSV import expects. Mirrors docs/api-contract.md; the API is the authority and
 * reports every problem row, so this only drives the help text, the template and the row count.
 */

export const MAX_CSV_BYTES = 2 * 1024 * 1024;

export const IMPORT_TYPES = [
  { value: "students", label: "Students" },
  { value: "courses", label: "Courses" },
  { value: "preferences", label: "Preferences" },
];

export const IMPORT_SPEC = {
  students: {
    title: "Students",
    summary: "One row per student.",
    required: [
      ["studentId", "Unique ID, for example 21CS001"],
      ["name", "Full name"],
      ["cgpa", "0 to 10"],
    ],
    optional: [
      ["department", "For example CSE"],
      ["semesterId", "The semester the student belongs to"],
      ["electiveGroups", "Groups they choose from, separated by ;"],
      ["isActive", "true or false"],
      ["email", "Needed on every row when logins are created"],
    ],
    example: ["21CS001", "Asha Rao", "8.7", "CSE", "SEM-5", "PE1;OE1", "true", "asha@college.edu"],
    header: ["studentId", "name", "cgpa", "department", "semesterId", "electiveGroups", "isActive", "email"],
  },
  courses: {
    title: "Courses",
    summary: "One row per course.",
    required: [
      ["courseCode", "For example CS101"],
      ["title", "Course title"],
      ["capacity", "Number of seats"],
      ["semesterId", "For example SEM-5"],
      ["electiveGroup", "Leave the cell empty for an open elective (offered to every group), or name one group such as OE1"],
    ],
    optional: [
      ["timetable", "Like Monday 09:00-10:00; Wed 11:00-12:00"],
      ["isActive", "true or false"],
    ],
    example: ["CS101", "Machine Learning", "60", "SEM-5", "PE1", "Monday 09:00-10:00; Wed 11:00-12:00", "true"],
    header: ["courseCode", "title", "capacity", "semesterId", "electiveGroup", "timetable", "isActive"],
  },
  preferences: {
    title: "Preferences",
    summary: "One row per ranked course. The rows of a list, in rank order, make the student's list.",
    required: [
      ["studentId", "The student's ID"],
      ["semesterId", "The semester"],
      ["electiveGroup", "The group this list is for, for example OE1 or OE2"],
      ["courseCode", "The course ranked (the same course may be in two groups' lists)"],
      ["rank", "1 is the first choice. A list has at most 15 courses; a submitted list needs 15, or every course available when fewer exist"],
    ],
    optional: [],
    example: ["21CS001", "SEM-5", "PE1", "CS101", "1"],
    header: ["studentId", "semesterId", "electiveGroup", "courseCode", "rank"],
  },
};

const cell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** A header row plus one example row, ready to save and fill in. */
export function templateCsv(type) {
  const spec = IMPORT_SPEC[type];
  return `${spec.header.join(",")}\n${spec.example.map(cell).join(",")}\n`;
}

/** Data rows in the text (non-empty lines after the header). A close estimate: quoted line breaks count as rows. */
export function countRows(text) {
  const lines = String(text ?? "").split(/\r?\n/).filter((l) => l.trim() !== "");
  return Math.max(0, lines.length - 1);
}

export function byteLength(text) {
  return new TextEncoder().encode(String(text ?? "")).length;
}

/** Same input and options means the same check result; used to allow "Import" only after a matching check. */
export function importSignature(type, text, options) {
  return JSON.stringify([type, text, options.onExisting, Boolean(options.createLogins), options.status]);
}
