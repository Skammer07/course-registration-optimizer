/**
 * The course add/edit form -> API payloads. Pure, so the rules are easy to test.
 * Slots are { day, start, end } with times "HH:MM", exactly what the API stores.
 */

import { WEEKDAYS, isValidSlot, toMinutes } from "../../lib/timetable.js";

export const NEW_SLOT = { day: "Monday", start: "09:00", end: "10:00" };

export const EMPTY_COURSE_FORM = {
  courseCode: "",
  title: "",
  capacity: "",
  electiveGroup: "",
  kind: "elective",
  departments: "",
  slots: [],
  isActive: true,
};

/** A stored course -> form values. */
export function courseToForm(course) {
  return {
    courseCode: course.courseCode,
    title: course.title ?? "",
    capacity: String(course.capacity ?? ""),
    electiveGroup: course.electiveGroup ?? "",
    kind: course.kind === "compulsory" ? "compulsory" : "elective",
    departments: (course.departments ?? []).join(", "),
    slots: (course.timetableSlots ?? []).map((s) => ({ day: s.day, start: s.start, end: s.end })),
    isActive: course.isActive !== false,
  };
}

/** "CSE, ECE ; cse" -> ["CSE", "ECE"] (blanks and repeats dropped, case ignored for repeats). */
export function parseDepartments(text) {
  const seen = new Set();
  const out = [];
  for (const part of String(text ?? "").split(/[,;]/)) {
    const dept = part.trim();
    if (dept && !seen.has(dept.toLowerCase())) {
      seen.add(dept.toLowerCase());
      out.push(dept);
    }
  }
  return out;
}

const slotKey = (s) => `${s.day}|${s.start}|${s.end}`;

/**
 * @param {typeof EMPTY_COURSE_FORM} form
 * @param {"create"|"edit"} mode
 * @returns {{ courseCode?: string, title?: string, capacity?: string, slots?: Record<number, string> }}
 *   empty object when valid
 */
export function validateCourseForm(form, mode) {
  const errors = {};

  if (mode === "create") {
    const code = form.courseCode.trim();
    if (!code) errors.courseCode = "Enter the course code, for example CS101.";
    else if (code.length > 40) errors.courseCode = "Use at most 40 characters.";
  }
  if (!form.title.trim()) errors.title = "Enter the course title.";

  // Compulsory courses are not allocated, so they have no seats and no group
  if (form.kind === "compulsory") {
    if (parseDepartments(form.departments).length === 0) {
      errors.departments = "Enter at least one department, for example CSE.";
    }
  } else {
    const capacity = Number(form.capacity);
    if (String(form.capacity).trim() === "" || !Number.isInteger(capacity) || capacity < 0) {
      errors.capacity = "Enter the number of seats as a whole number, 0 or more.";
    }
  }

  const slotErrors = {};
  const seen = new Set();
  form.slots.forEach((s, i) => {
    if (!WEEKDAYS.includes(s.day)) slotErrors[i] = "Choose a weekday.";
    else if (toMinutes(s.start) === null || toMinutes(s.end) === null) slotErrors[i] = "Enter both times.";
    else if (!isValidSlot(s)) slotErrors[i] = "The class must end after it starts.";
    else if (seen.has(slotKey(s))) slotErrors[i] = "This slot is listed twice.";
    seen.add(slotKey(s));
  });
  if (Object.keys(slotErrors).length > 0) errors.slots = slotErrors;

  return errors;
}

const slotsPayload = (slots) => slots.map((s) => ({ day: s.day, start: s.start, end: s.end }));

/** POST /courses body. The semester is the one being viewed. */
export function buildCreatePayload(form, semesterId) {
  const compulsory = form.kind === "compulsory";
  return {
    courseCode: form.courseCode.trim().toUpperCase(),
    title: form.title.trim(),
    ...(compulsory ? {} : { capacity: Number(form.capacity) }),
    semesterId,
    kind: compulsory ? "compulsory" : "elective",
    departments: compulsory ? parseDepartments(form.departments) : [],
    electiveGroup: compulsory ? null : form.electiveGroup.trim() || null,
    timetableSlots: slotsPayload(form.slots),
    isActive: true,
  };
}

/**
 * PATCH /courses/:id body: only what changed. Whether a course is active is an admin decision,
 * so it is sent only for an admin and only when it changed.
 */
export function buildUpdatePayload(form, original, { isAdmin }) {
  const payload = {};
  if (form.title.trim() !== (original.title ?? "")) payload.title = form.title.trim();
  const compulsory = form.kind === "compulsory";
  const originalKind = original.kind === "compulsory" ? "compulsory" : "elective";
  if (form.kind !== originalKind) payload.kind = form.kind;

  if (!compulsory && Number(form.capacity) !== original.capacity) payload.capacity = Number(form.capacity);
  const group = compulsory ? null : form.electiveGroup.trim() || null;
  if (group !== (original.electiveGroup ?? null)) payload.electiveGroup = group;

  const departments = compulsory ? parseDepartments(form.departments) : [];
  if (departments.join("|") !== (original.departments ?? []).join("|")) payload.departments = departments;

  const before = (original.timetableSlots ?? []).map(slotKey).join(";");
  const after = form.slots.map(slotKey).join(";");
  if (before !== after) payload.timetableSlots = slotsPayload(form.slots);

  if (isAdmin && form.isActive !== (original.isActive !== false)) payload.isActive = form.isActive;
  return payload;
}
