/**
 * The student add/edit form -> API payloads. Pure, so the rules are easy to test.
 * Faculty may change a student's name and department; marks, groups, semester and whether the
 * student is active affect allocation, so only an admin may change those (the API enforces it too).
 */

export const EMPTY_STUDENT_FORM = {
  studentId: "",
  name: "",
  cgpa: "",
  department: "",
  electiveGroups: "",
  isActive: true,
};

/** "A, B ,a" -> ["A", "B"] (trimmed, no empties, no repeats). */
export function parseGroups(text) {
  const out = [];
  for (const part of String(text ?? "").split(",")) {
    const g = part.trim();
    if (g && !out.includes(g)) out.push(g);
  }
  return out;
}

export function studentToForm(student) {
  return {
    studentId: student.studentId,
    name: student.name ?? "",
    cgpa: student.cgpa == null ? "" : String(student.cgpa),
    department: student.department ?? "",
    electiveGroups: (student.electiveGroups ?? []).join(", "),
    isActive: student.isActive !== false,
  };
}

/** @returns {{ studentId?: string, name?: string, cgpa?: string }} empty when valid */
export function validateStudentForm(form, mode) {
  const errors = {};
  if (mode === "create" && !form.studentId.trim()) errors.studentId = "Enter the student ID, for example 21CS001.";
  if (!form.name.trim()) errors.name = "Enter the student's name.";

  const text = String(form.cgpa).trim();
  const cgpa = Number(text);
  if (text === "" || Number.isNaN(cgpa) || cgpa < 0 || cgpa > 10) errors.cgpa = "Enter a CGPA between 0 and 10.";
  return errors;
}

export function buildCreatePayload(form, semesterId) {
  return {
    studentId: form.studentId.trim().toUpperCase(),
    name: form.name.trim(),
    cgpa: Number(form.cgpa),
    department: form.department.trim(),
    semesterId,
    electiveGroups: parseGroups(form.electiveGroups),
    isActive: true,
  };
}

/** PATCH body with only what changed, and only the fields this role may change. */
export function buildUpdatePayload(form, original, { isAdmin }) {
  const payload = {};
  if (form.name.trim() !== (original.name ?? "")) payload.name = form.name.trim();
  if (form.department.trim() !== (original.department ?? "")) payload.department = form.department.trim();
  if (!isAdmin) return payload;

  if (Number(form.cgpa) !== original.cgpa) payload.cgpa = Number(form.cgpa);
  const groups = parseGroups(form.electiveGroups);
  if (groups.join("|") !== (original.electiveGroups ?? []).join("|")) payload.electiveGroups = groups;
  if (form.isActive !== (original.isActive !== false)) payload.isActive = form.isActive;
  return payload;
}
