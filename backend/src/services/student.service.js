/**
 * src/services/student.service.js
 * Business logic for student CRUD.
 *
 * Search inputs are escaped before being used in RegExp to prevent ReDoS.
 * Only allowlisted fields are applied in updates (mass-assignment guard).
 */

import Student from "../models/Student.js";
import { ApiError } from "../utils/ApiError.js";

/** Escape a string so it is safe to embed in a RegExp literal. */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip non-whitelisted fields from an update payload to prevent
 * mass-assignment of protected or immutable fields.
 */
const UPDATABLE_STUDENT_FIELDS = new Set([
  "name",
  "cgpa",
  "department",
  "semesterId",
  "electiveGroups",
  "isActive",
]);

function sanitizeStudentUpdate(data) {
  const safe = {};
  for (const key of UPDATABLE_STUDENT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      safe[key] = data[key];
    }
  }
  return safe;
}

/**
 * Fields that may be returned in student API responses.
 * This allowlist protects against any unexpected fields being returned,
 * including accidental schema additions or test fixture leaks.
 */
const STUDENT_RESPONSE_FIELDS = new Set([
  "_id", "studentId", "name", "cgpa", "department",
  "semesterId", "electiveGroups", "isActive", "createdAt", "updatedAt",
]);

/** Strip any fields not in the allowlist from a student lean document. */
function sanitizeStudent(doc) {
  if (!doc) return doc;
  const safe = {};
  for (const key of STUDENT_RESPONSE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(doc, key)) {
      safe[key] = doc[key];
    }
  }
  return safe;
}

export async function listStudents({ semesterId, department, search, page, limit }) {
  const filter = {};
  if (semesterId) filter.semesterId = semesterId;
  if (department) filter.department = new RegExp(escapeRegex(department), "i");
  if (search) {
    const safeSearch = escapeRegex(search);
    filter.$or = [
      { name: new RegExp(safeSearch, "i") },
      { studentId: new RegExp(safeSearch, "i") },
    ];
  }

  const skip = (page - 1) * limit;
  const [students, total] = await Promise.all([
    Student.find(filter).select("-__v").sort({ studentId: 1 }).skip(skip).limit(limit).lean(),
    Student.countDocuments(filter),
  ]);

  return { students: students.map(sanitizeStudent), total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function getStudentById(id) {
  // Explicit projection ensures only Student schema fields are returned.
  const projection = "studentId name cgpa department semesterId electiveGroups isActive createdAt updatedAt";
  const student = await Student.findById(id).select(projection).lean();
  if (!student) throw ApiError.notFound("Student");
  return sanitizeStudent(student);
}

export async function getStudentByStudentId(studentId) {
  const student = await Student.findOne({ studentId: studentId.toUpperCase() }).lean();
  if (!student) throw ApiError.notFound("Student");
  return student;
}

export async function createStudent(data) {
  const student = await Student.create(data);
  return sanitizeStudent(student.toObject());
}

export async function updateStudent(id, data) {
  const safeData = sanitizeStudentUpdate(data);
  if (Object.keys(safeData).length === 0) {
    throw ApiError.badRequest("No updatable fields provided.");
  }
  const student = await Student.findByIdAndUpdate(
    id,
    { $set: safeData },
    { new: true, runValidators: true }
  ).lean();
  if (!student) throw ApiError.notFound("Student");
  return sanitizeStudent(student);
}

/**
 * Soft-delete: deactivate rather than physically remove,
 * since students may be referenced by existing allocation history.
 */
export async function deactivateStudent(id) {
  const student = await Student.findByIdAndUpdate(
    id,
    { $set: { isActive: false } },
    { new: true }
  ).lean();
  if (!student) throw ApiError.notFound("Student");
  return sanitizeStudent(student);
}

