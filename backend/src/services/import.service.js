/**
 * src/services/import.service.js
 * Bulk import of students, courses and preference lists from CSV (admin).
 *
 * RULES
 *   - ALL-OR-NOTHING VALIDATION: every row is checked before anything is
 *     written. Any problem returns 422 with the row/column of up to 50
 *     problems and nothing is imported.
 *   - dryRun=true runs the full validation and reports what WOULD happen.
 *   - Existing records are skipped by default (onExisting=skip). With
 *     onExisting=update they are updated; empty cells never overwrite.
 *   - Without transactions (standalone MongoDB) records this import created
 *     are removed again if a later step fails; updates are applied last.
 *   - Login passwords (students, createLogins=true) are generated, returned
 *     ONCE, and only hashes are stored. Logins must change them at first use.
 *   - Admin imports bypass the preference deadline; they are an admin action.
 */

import Student from "../models/Student.js";
import Course from "../models/Course.js";
import Preference from "../models/Preference.js";
import User from "../models/User.js";
import { hashPassword } from "./auth.service.js";
import { generateTemporaryPassword } from "../utils/password.js";
import { parseCsv, CsvParseError, buildCsv } from "../utils/csv.js";
import { WEEKDAYS, isValidSlot, timeToMinutes } from "../utils/timetable.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../utils/logger.js";

export const MAX_IMPORT_ROWS = 5000;
export const MAX_LOGINS_PER_IMPORT = 500;
const MAX_REPORTED_PROBLEMS = 50;
const HASH_CONCURRENCY = 4;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normKey = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, "");

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

class Problems {
  constructor() {
    this.total = 0;
    this.list = [];
  }
  add(line, column, message) {
    this.total++;
    if (this.list.length < MAX_REPORTED_PROBLEMS) this.list.push({ row: line, column, message });
  }
  get any() {
    return this.total > 0;
  }
  throwIfAny() {
    if (!this.any) return;
    const more = this.total > this.list.length ? ` (showing the first ${this.list.length})` : "";
    throw new ApiError(
      422,
      `${this.total} problem(s) found${more}; nothing was imported.`,
      "IMPORT_VALIDATION_FAILED",
      this.list
    );
  }
}

/** Read the CSV into objects keyed by canonical column name; structural problems -> 400/422. */
function readTable(text, { required, optional }) {
  if (typeof text !== "string" || text.trim() === "") {
    throw ApiError.badRequest("Send the CSV as the request body with Content-Type: text/csv.");
  }

  let records;
  try {
    records = parseCsv(text);
  } catch (err) {
    if (err instanceof CsvParseError) {
      throw ApiError.badRequest(`The file is not valid CSV${err.line ? ` (line ${err.line})` : ""}: ${err.message}`);
    }
    throw err;
  }
  if (records.length < 2) {
    throw ApiError.badRequest("The CSV needs a header row and at least one data row.");
  }
  if (records.length - 1 > MAX_IMPORT_ROWS) {
    throw ApiError.badRequest(`Too many rows: ${records.length - 1} (maximum ${MAX_IMPORT_ROWS} per import).`);
  }

  const known = new Map([...required, ...optional].map((c) => [normKey(c), c]));
  const problems = new Problems();
  const columns = []; // canonical name per header position (or null)
  const seen = new Set();
  for (const raw of records[0].cells) {
    const canonical = known.get(normKey(raw));
    if (!canonical) {
      problems.add(records[0].line, raw.trim(), `Unknown column "${raw.trim()}". Allowed: ${[...known.values()].join(", ")}.`);
      columns.push(null);
      continue;
    }
    if (seen.has(canonical)) problems.add(records[0].line, canonical, `Column "${canonical}" appears twice.`);
    seen.add(canonical);
    columns.push(canonical);
  }
  for (const col of required) {
    if (!seen.has(col)) problems.add(records[0].line, col, `Required column "${col}" is missing.`);
  }
  problems.throwIfAny();

  const rows = records.slice(1).map((rec) => {
    if (rec.cells.length > columns.length) {
      problems.add(rec.line, null, `Row has ${rec.cells.length} values but the header has ${columns.length} columns.`);
    }
    const values = {};
    columns.forEach((col, i) => {
      if (col) values[col] = (rec.cells[i] ?? "").trim();
    });
    return { line: rec.line, values };
  });
  problems.throwIfAny();

  return { rows, columns: new Set(columns.filter(Boolean)), problems };
}

function parseBool(value) {
  const v = String(value).trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(v)) return true;
  if (["false", "no", "n", "0"].includes(v)) return false;
  return undefined;
}

function splitList(value) {
  return [...new Set(String(value).split(";").map((x) => x.trim()).filter(Boolean))];
}

async function inChunks(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

function summary(extra) {
  return { ...extra };
}

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

export async function importStudents(text, { dryRun = false, onExisting = "skip", createLogins = false } = {}) {
  const spec = {
    required: ["studentId", "name", "cgpa"],
    optional: ["department", "semesterId", "electiveGroups", "isActive", "email"],
  };
  const { rows, columns, problems } = readTable(text, spec);
  if (createLogins && !columns.has("email")) {
    throw ApiError.badRequest('createLogins=true needs an "email" column.');
  }

  const parsed = [];
  const ids = new Set();
  const emails = new Map();
  for (const { line, values } of rows) {
    const studentId = values.studentId.toUpperCase();
    if (!studentId) problems.add(line, "studentId", "studentId is required.");
    else if (studentId.length > 50) problems.add(line, "studentId", "studentId is longer than 50 characters.");
    else if (ids.has(studentId)) problems.add(line, "studentId", `Duplicate studentId "${studentId}" in the file.`);
    ids.add(studentId);

    if (!values.name) problems.add(line, "name", "name is required.");

    const cgpa = values.cgpa === "" ? NaN : Number(values.cgpa);
    if (!Number.isFinite(cgpa) || cgpa < 0 || cgpa > 10) problems.add(line, "cgpa", "cgpa must be a number from 0 to 10.");

    let isActive;
    if (values.isActive !== undefined && values.isActive !== "") {
      isActive = parseBool(values.isActive);
      if (isActive === undefined) problems.add(line, "isActive", 'isActive must be true/false (or yes/no, 1/0).');
    }

    let email = null;
    if (columns.has("email") && values.email) {
      email = values.email.toLowerCase();
      if (!EMAIL_RE.test(email) || email.length > 254) problems.add(line, "email", "Invalid email address.");
      else if (emails.has(email)) problems.add(line, "email", `Email "${email}" appears twice in the file.`);
      emails.set(email, line);
    } else if (createLogins) {
      problems.add(line, "email", "email is required when createLogins=true.");
    }

    parsed.push({
      line, studentId, name: values.name, cgpa,
      department: values.department, semesterId: values.semesterId,
      electiveGroups: columns.has("electiveGroups") ? splitList(values.electiveGroups ?? "") : undefined,
      isActive, email,
    });
  }
  problems.throwIfAny();

  // ---- compare with the database ----------------------------------------------
  const existing = await Student.find({ studentId: { $in: [...ids] } }).select("studentId").lean();
  const existingByCode = new Map(existing.map((s) => [s.studentId, s]));
  const existingLogins = existing.length
    ? await User.find({ student: { $in: existing.map((s) => s._id) } }).select("student").lean()
    : [];
  const hasLogin = new Set(existingLogins.map((u) => String(u.student)));

  const toCreate = parsed.filter((p) => !existingByCode.has(p.studentId));
  const existingRows = parsed.filter((p) => existingByCode.has(p.studentId));
  const toUpdate = onExisting === "update" ? existingRows : [];
  const skipped = onExisting === "update" ? [] : existingRows;

  // logins: only for students without one
  let loginRows = [];
  if (createLogins) {
    loginRows = parsed.filter((p) => {
      const ex = existingByCode.get(p.studentId);
      return !ex || !hasLogin.has(String(ex._id));
    });
    if (loginRows.length > MAX_LOGINS_PER_IMPORT) {
      throw ApiError.badRequest(
        `Too many logins for one import: ${loginRows.length} (maximum ${MAX_LOGINS_PER_IMPORT}). Split the file.`
      );
    }
    const taken = loginRows.length
      ? await User.find({ email: { $in: loginRows.map((r) => r.email) } }).select("email").lean()
      : [];
    for (const t of taken) {
      const row = loginRows.find((r) => r.email === t.email);
      problems.add(row.line, "email", `Email "${t.email}" already belongs to another account.`);
    }
    problems.throwIfAny();
  }

  const result = summary({
    dryRun,
    totalRows: parsed.length,
    created: toCreate.length,
    updated: toUpdate.length,
    skipped: skipped.length,
    skippedStudentIds: skipped.slice(0, 20).map((s) => s.studentId),
    loginsCreated: loginRows.length,
  });
  if (dryRun) return result;

  // ---- write: creates -> logins -> updates ------------------------------------
  const createdStudents = [];
  const createdUsers = [];
  const rollback = async () => {
    try {
      if (createdUsers.length) await User.deleteMany({ _id: { $in: createdUsers } });
      if (createdStudents.length) await Student.deleteMany({ _id: { $in: createdStudents } });
    } catch (err) {
      logger.error({ err: err.message }, "Student import rollback failed");
    }
  };

  try {
    let inserted = [];
    if (toCreate.length) {
      inserted = await Student.insertMany(
        toCreate.map((r) => ({
          studentId: r.studentId, name: r.name, cgpa: r.cgpa,
          department: r.department ?? "", semesterId: r.semesterId ?? "",
          electiveGroups: r.electiveGroups ?? [], isActive: r.isActive ?? true,
        })),
        { ordered: true }
      );
      createdStudents.push(...inserted.map((s) => s._id));
    }

    const oidByCode = new Map(inserted.map((s) => [s.studentId, s._id]));
    for (const [code, doc] of existingByCode) oidByCode.set(code, doc._id);

    const credentials = [];
    if (loginRows.length) {
      const prepared = await inChunks(loginRows, HASH_CONCURRENCY, async (r) => {
        const temporaryPassword = generateTemporaryPassword();
        return { row: r, temporaryPassword, passwordHash: await hashPassword(temporaryPassword) };
      });
      const users = await User.insertMany(
        prepared.map((p) => ({
          email: p.row.email, passwordHash: p.passwordHash, role: "student",
          student: oidByCode.get(p.row.studentId), isActive: true, mustChangePassword: true,
        })),
        { ordered: true }
      );
      createdUsers.push(...users.map((u) => u._id));
      for (const p of prepared) {
        credentials.push({ studentId: p.row.studentId, email: p.row.email, temporaryPassword: p.temporaryPassword });
      }
    }

    if (toUpdate.length) {
      const ops = toUpdate.map((r) => {
        const set = { name: r.name, cgpa: r.cgpa };
        if (r.department) set.department = r.department;
        if (r.semesterId) set.semesterId = r.semesterId;
        if (r.electiveGroups && r.electiveGroups.length) set.electiveGroups = r.electiveGroups;
        if (r.isActive !== undefined) set.isActive = r.isActive;
        return { updateOne: { filter: { studentId: r.studentId }, update: { $set: set } } };
      });
      await Student.bulkWrite(ops, { ordered: true });
    }

    logger.info(
      { created: toCreate.length, updated: toUpdate.length, logins: credentials.length },
      "Student CSV import completed"
    );
    return {
      ...result,
      credentials,
      credentialsCsv: credentials.length
        ? buildCsv(["studentId", "email", "temporaryPassword"], credentials.map((c) => [c.studentId, c.email, c.temporaryPassword]))
        : null,
    };
  } catch (err) {
    await rollback();
    if (err instanceof ApiError) throw err;
    logger.error({ err: err.message }, "Student CSV import failed; created records were removed");
    throw new ApiError(500, "The import failed and the records it created were removed.", "IMPORT_FAILED");
  }
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

const DAY_BY_KEY = new Map();
for (const day of WEEKDAYS) {
  DAY_BY_KEY.set(day.toLowerCase(), day);
  DAY_BY_KEY.set(day.slice(0, 3).toLowerCase(), day);
}

const pad = (hhmm) => {
  const [h, m] = hhmm.split(":");
  return `${h.padStart(2, "0")}:${m}`;
};

/** "Monday 09:00-10:00; Wed 11:00-12:00" -> slots, or { error } */
export function parseTimetableCell(cell) {
  const slots = [];
  for (const token of String(cell).split(";").map((t) => t.trim()).filter(Boolean)) {
    const m = /^([A-Za-z]+)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(token);
    if (!m) return { error: `"${token}" is not in the form "Monday 09:00-10:00".` };
    const day = DAY_BY_KEY.get(m[1].toLowerCase());
    if (!day) return { error: `"${m[1]}" is not a weekday.` };
    const slot = { day, start: pad(m[2]), end: pad(m[3]) };
    if (timeToMinutes(slot.start) === null || timeToMinutes(slot.end) === null) {
      return { error: `"${token}" has an invalid time.` };
    }
    if (!isValidSlot(slot)) return { error: `"${token}": the start time must be before the end time.` };
    slots.push(slot);
  }
  return { slots };
}

export async function importCourses(text, { dryRun = false, onExisting = "skip" } = {}) {
  const spec = {
    required: ["courseCode", "title", "capacity", "semesterId", "electiveGroup"],
    optional: ["timetable", "isActive"],
  };
  const { rows, columns, problems } = readTable(text, spec);

  const parsed = [];
  const keys = new Set();
  for (const { line, values } of rows) {
    const courseCode = values.courseCode.toUpperCase();
    if (!courseCode) problems.add(line, "courseCode", "courseCode is required.");
    if (!values.title) problems.add(line, "title", "title is required.");
    if (!values.semesterId) problems.add(line, "semesterId", "semesterId is required.");
    if (!values.electiveGroup) problems.add(line, "electiveGroup", "electiveGroup is required.");

    const capacity = values.capacity === "" ? NaN : Number(values.capacity);
    if (!Number.isInteger(capacity) || capacity < 0) problems.add(line, "capacity", "capacity must be a whole number, 0 or more.");

    const key = `${courseCode}::${values.semesterId}`;
    if (courseCode && values.semesterId) {
      if (keys.has(key)) problems.add(line, "courseCode", `Duplicate course "${courseCode}" in semester "${values.semesterId}" in the file.`);
      keys.add(key);
    }

    let timetableSlots;
    if (columns.has("timetable") && values.timetable) {
      const t = parseTimetableCell(values.timetable);
      if (t.error) problems.add(line, "timetable", t.error);
      else timetableSlots = t.slots;
    }

    let isActive;
    if (values.isActive !== undefined && values.isActive !== "") {
      isActive = parseBool(values.isActive);
      if (isActive === undefined) problems.add(line, "isActive", "isActive must be true/false (or yes/no, 1/0).");
    }

    parsed.push({
      line, courseCode, title: values.title, capacity, semesterId: values.semesterId,
      electiveGroup: values.electiveGroup, timetableSlots, isActive,
    });
  }
  problems.throwIfAny();

  const found = await Course.find({ courseCode: { $in: [...new Set(parsed.map((p) => p.courseCode))] } })
    .select("courseCode semesterId")
    .lean();
  const existingKeys = new Set(found.map((c) => `${c.courseCode}::${c.semesterId}`));
  const isExisting = (p) => existingKeys.has(`${p.courseCode}::${p.semesterId}`);

  const toCreate = parsed.filter((p) => !isExisting(p));
  const existingRows = parsed.filter(isExisting);
  const toUpdate = onExisting === "update" ? existingRows : [];
  const skipped = onExisting === "update" ? [] : existingRows;

  const result = summary({
    dryRun,
    totalRows: parsed.length,
    created: toCreate.length,
    updated: toUpdate.length,
    skipped: skipped.length,
    skippedCourses: skipped.slice(0, 20).map((c) => `${c.courseCode} (${c.semesterId})`),
  });
  if (dryRun) return result;

  const createdIds = [];
  try {
    if (toCreate.length) {
      const inserted = await Course.insertMany(
        toCreate.map((r) => ({
          courseCode: r.courseCode, title: r.title, capacity: r.capacity, semesterId: r.semesterId,
          electiveGroup: r.electiveGroup, timetableSlots: r.timetableSlots ?? [], isActive: r.isActive ?? true,
        })),
        { ordered: true }
      );
      createdIds.push(...inserted.map((c) => c._id));
    }
    if (toUpdate.length) {
      await Course.bulkWrite(
        toUpdate.map((r) => {
          const set = { title: r.title, capacity: r.capacity, electiveGroup: r.electiveGroup };
          if (r.timetableSlots) set.timetableSlots = r.timetableSlots;
          if (r.isActive !== undefined) set.isActive = r.isActive;
          return { updateOne: { filter: { courseCode: r.courseCode, semesterId: r.semesterId }, update: { $set: set } } };
        }),
        { ordered: true }
      );
    }
    logger.info({ created: toCreate.length, updated: toUpdate.length }, "Course CSV import completed");
    return result;
  } catch (err) {
    try {
      if (createdIds.length) await Course.deleteMany({ _id: { $in: createdIds } });
    } catch (cleanupErr) {
      logger.error({ err: cleanupErr.message }, "Course import rollback failed");
    }
    logger.error({ err: err.message }, "Course CSV import failed; created records were removed");
    throw new ApiError(500, "The import failed and the records it created were removed.", "IMPORT_FAILED");
  }
}

// ---------------------------------------------------------------------------
// Preferences (one row per ranked course)
// ---------------------------------------------------------------------------

export async function importPreferences(text, { dryRun = false, onExisting = "skip", status = "submitted" } = {}) {
  const spec = { required: ["studentId", "semesterId", "electiveGroup", "courseCode", "rank"], optional: [] };
  const { rows, problems } = readTable(text, spec);

  // Rows with a malformed cell are reported and left out of the grouping below,
  // so one bad row does not hide the other problems.
  const parsed = [];
  for (const { line, values } of rows) {
    let rowOk = true;
    const rank = values.rank === "" ? NaN : Number(values.rank);
    if (!Number.isInteger(rank) || rank < 1) {
      problems.add(line, "rank", "rank must be a whole number, 1 or more.");
      rowOk = false;
    }
    for (const col of ["studentId", "semesterId", "electiveGroup", "courseCode"]) {
      if (!values[col]) {
        problems.add(line, col, `${col} is required.`);
        rowOk = false;
      }
    }
    if (!rowOk) continue;
    parsed.push({
      line, rank,
      studentId: values.studentId.toUpperCase(), semesterId: values.semesterId,
      electiveGroup: values.electiveGroup, courseCode: values.courseCode.toUpperCase(),
    });
  }

  // ---- group into lists -----------------------------------------------------------
  const groups = new Map();
  for (const p of parsed) {
    const key = `${p.studentId}::${p.semesterId}::${p.electiveGroup}`;
    if (!groups.has(key)) groups.set(key, { studentId: p.studentId, semesterId: p.semesterId, electiveGroup: p.electiveGroup, items: [] });
    groups.get(key).items.push(p);
  }

  const students = await Student.find({ studentId: { $in: [...new Set(parsed.map((p) => p.studentId))] } })
    .select("studentId semesterId electiveGroups isActive")
    .lean();
  const studentByCode = new Map(students.map((s) => [s.studentId, s]));
  const courses = await Course.find({
    courseCode: { $in: [...new Set(parsed.map((p) => p.courseCode))] },
    semesterId: { $in: [...new Set(parsed.map((p) => p.semesterId))] },
  })
    .select("courseCode semesterId electiveGroup isActive")
    .lean();
  const courseByKey = new Map(courses.map((c) => [`${c.semesterId}::${c.courseCode}`, c]));

  const lists = [];
  for (const group of groups.values()) {
    const first = group.items[0];
    const student = studentByCode.get(group.studentId);
    if (!student) {
      problems.add(first.line, "studentId", `No student with studentId "${group.studentId}".`);
      continue;
    }
    if (student.isActive === false) problems.add(first.line, "studentId", `Student "${group.studentId}" is not active.`);
    if (!student.semesterId || student.semesterId !== group.semesterId) {
      problems.add(first.line, "semesterId", `Student "${group.studentId}" is not registered for semester "${group.semesterId}".`);
    }
    if (student.electiveGroups?.length && !student.electiveGroups.includes(group.electiveGroup)) {
      problems.add(first.line, "electiveGroup", `Student "${group.studentId}" is not eligible for group "${group.electiveGroup}".`);
    }

    const ranks = new Set();
    const codes = new Set();
    const ordered = [...group.items].sort((a, b) => a.rank - b.rank);
    const courseIds = [];
    for (const item of ordered) {
      if (ranks.has(item.rank)) problems.add(item.line, "rank", `Rank ${item.rank} is used twice for ${group.studentId} in group ${group.electiveGroup}.`);
      ranks.add(item.rank);
      if (codes.has(item.courseCode)) problems.add(item.line, "courseCode", `Course "${item.courseCode}" is ranked twice for ${group.studentId}.`);
      codes.add(item.courseCode);

      const course = courseByKey.get(`${group.semesterId}::${item.courseCode}`);
      if (!course) {
        problems.add(item.line, "courseCode", `No course "${item.courseCode}" in semester "${group.semesterId}".`);
      } else {
        if (course.isActive === false) problems.add(item.line, "courseCode", `Course "${item.courseCode}" is not active.`);
        if (course.electiveGroup !== group.electiveGroup) {
          problems.add(item.line, "courseCode", `Course "${item.courseCode}" is not in elective group "${group.electiveGroup}".`);
        }
        courseIds.push(course._id);
      }
    }
    lists.push({ ...group, student, courseIds });
  }
  problems.throwIfAny();

  const found = await Preference.find({ student: { $in: lists.map((l) => l.student._id) } })
    .select("student semesterId electiveGroup")
    .lean();
  const existingKeys = new Set(found.map((f) => `${f.student}::${f.semesterId}::${f.electiveGroup}`));
  const isExisting = (l) => existingKeys.has(`${l.student._id}::${l.semesterId}::${l.electiveGroup}`);

  const toCreate = lists.filter((l) => !isExisting(l));
  const existingLists = lists.filter(isExisting);
  const toUpdate = onExisting === "update" ? existingLists : [];
  const skipped = onExisting === "update" ? [] : existingLists;

  const result = summary({
    dryRun,
    totalRows: parsed.length,
    lists: lists.length,
    created: toCreate.length,
    updated: toUpdate.length,
    skipped: skipped.length,
    status,
  });
  if (dryRun) return result;

  try {
    const now = new Date();
    const ops = [...toCreate, ...toUpdate].map((l) => ({
      updateOne: {
        filter: { student: l.student._id, semesterId: l.semesterId, electiveGroup: l.electiveGroup },
        update: { $set: { rankedCourseIds: l.courseIds, status, ...(status === "submitted" ? { submittedAt: now } : {}) } },
        upsert: true,
      },
    }));
    if (ops.length) await Preference.bulkWrite(ops, { ordered: true });
    logger.info({ created: toCreate.length, updated: toUpdate.length }, "Preference CSV import completed");
    return result;
  } catch (err) {
    logger.error({ err: err.message }, "Preference CSV import failed");
    throw new ApiError(500, "The import failed part-way; re-running it with onExisting=update is safe.", "IMPORT_FAILED");
  }
}
