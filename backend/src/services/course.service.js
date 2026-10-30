/**
 * src/services/course.service.js
 * Business logic for course CRUD.
 *
 * Search inputs are escaped before being used in RegExp to prevent ReDoS.
 * Only allowlisted fields are applied in updates (mass-assignment guard).
 */

import Course from "../models/Course.js";
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

export async function listCourses({ semesterId, electiveGroup, search, isActive, page, limit }) {
  const filter = {};
  if (semesterId) filter.semesterId = semesterId;
  if (electiveGroup) filter.electiveGroup = electiveGroup;
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

