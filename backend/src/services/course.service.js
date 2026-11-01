/**
 * src/services/course.service.js
 * Business logic for course CRUD.
 *
 * Search inputs are escaped before being used in RegExp to prevent ReDoS.
 * Only allowlisted fields are applied in updates (mass-assignment guard).
 */

import Course from "../models/Course.js";
import { courseKindProblem, compulsoryCoursesForDepartment } from "../utils/courseKind.js";
import Student from "../models/Student.js";
import { ApiError } from "../utils/ApiError.js";

/** Escape a string so it is safe to embed in a RegExp literal. */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip non-whitelisted fields from an update payload to prevent
 * mass-assignment of protected or immutable fields (courseCode, semesterId are immutable).
 */
const UPDATABLE_COURSE_FIELDS = new Set([
  "title",
  "capacity",
  "electiveGroup",
  "kind",
  "departments",
  "timetableSlots",
  "isActive",
]);

function sanitizeCourseUpdate(data) {
  const safe = {};
  for (const key of UPDATABLE_COURSE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      safe[key] = data[key];
    }
  }
  return safe;
}

export async function listCourses({ semesterId, electiveGroup, kind, search, isActive, page, limit }) {
  const filter = {};
  if (semesterId) filter.semesterId = semesterId;
  if (electiveGroup) filter.electiveGroup = electiveGroup;
  // Courses saved before kinds existed have no kind and are electives
  if (kind === "compulsory") filter.kind = "compulsory";
  else if (kind === "elective") filter.kind = { $ne: "compulsory" };
  if (search) {
    const safeSearch = escapeRegex(search);
    filter.$or = [
      { courseCode: new RegExp(safeSearch, "i") },
      { title: new RegExp(safeSearch, "i") },
    ];
  }
  if (isActive !== undefined) {
    filter.isActive = isActive === "true";
  }

  const skip = (page - 1) * limit;
  const [courses, total] = await Promise.all([
    Course.find(filter).sort({ courseCode: 1 }).skip(skip).limit(limit).lean(),
    Course.countDocuments(filter),
  ]);

  return { courses, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function getCourseById(id) {
  const course = await Course.findById(id).lean();
  if (!course) throw ApiError.notFound("Course");
  return course;
}

export async function createCourse(data) {
  const course = await Course.create(data);
  return course.toObject();
}

export async function updateCourse(id, data) {
  const safeData = sanitizeCourseUpdate(data);
  if (Object.keys(safeData).length === 0) {
    throw ApiError.badRequest("No updatable fields provided.");
  }
  // Update validators cannot compare fields with each other, so check the
  // result of the change here.
  const existing = await Course.findById(id).lean();
  if (!existing) throw ApiError.notFound("Course");
  const problem = courseKindProblem({ ...existing, ...safeData });
  if (problem) throw ApiError.badRequest(problem);
  if ((safeData.kind ?? existing.kind) !== "compulsory" && existing.capacity === undefined && safeData.capacity === undefined) {
    throw ApiError.badRequest("Capacity is required for an elective course.");
  }

  const course = await Course.findByIdAndUpdate(
    id,
    { $set: safeData },
    { new: true, runValidators: true }
  ).lean();
  if (!course) throw ApiError.notFound("Course");
  return course;
}

/**
 * Soft-delete: deactivate the course rather than physically deleting it,
 * since courses may be referenced by existing allocation history.
 */
export async function deactivateCourse(id) {
  const course = await Course.findByIdAndUpdate(
    id,
    { $set: { isActive: false } },
    { new: true }
  ).lean();
  if (!course) throw ApiError.notFound("Course");
  return course;
}


/**
 * The signed-in student's own compulsory courses for their semester, with
 * their weekly times. Identity comes only from the session, never from input.
 */
export async function listMyCompulsoryCourses(studentObjectId) {
  const student = studentObjectId
    ? await Student.findById(studentObjectId).select("studentId department semesterId").lean()
    : null;
  if (!student) {
    throw ApiError.badRequest("Your user account is not linked to a student record.");
  }

  const base = { semesterId: student.semesterId || null, department: student.department || null };
  if (!student.semesterId) return { ...base, courses: [] };

  const compulsory = await Course.find({
    semesterId: student.semesterId,
    kind: "compulsory",
    isActive: true,
  })
    .sort({ courseCode: 1 })
    .lean();

  return {
    ...base,
    courses: compulsoryCoursesForDepartment(compulsory, student.department).map((c) => ({
      courseCode: c.courseCode,
      title: c.title,
      timetableSlots: (c.timetableSlots ?? []).map((s) => ({ day: s.day, start: s.start, end: s.end })),
    })),
  };
}
