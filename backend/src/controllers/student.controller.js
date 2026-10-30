/**
 * src/controllers/student.controller.js
 *
 * Ownership rule for GET /:id:
 *   - admin / faculty: may access any student record
 *   - student role:    may only access the Student document linked to their own
 *                      user account (req.user.student ObjectId must match the
 *                      student's _id). Never trust a client-supplied student ID.
 */

import { asyncHandler } from "../utils/asyncHandler.js";
import { success, created } from "../utils/respond.js";
import * as studentService from "../services/student.service.js";
import { ApiError } from "../utils/ApiError.js";

export const list = asyncHandler(async (req, res) => {
  const result = await studentService.listStudents(req.query);
  return success(res, result, "Students retrieved");
});

export const getOne = asyncHandler(async (req, res) => {
  const student = await studentService.getStudentById(req.params.id);

  // Students may only view their own record
  if (req.user.role === "student") {
    // req.user.student is the ObjectId of the linked Student document
    if (!req.user.student || req.user.student.toString() !== student._id.toString()) {
      throw ApiError.forbidden("You are not authorized to view this student record.");
    }
  }

  return success(res, { student }, "Student retrieved");
});

export const create = asyncHandler(async (req, res) => {
  const student = await studentService.createStudent(req.body);
  return created(res, { student }, "Student created");
});

/**
 * Fields that affect allocation outcomes (merit ranking, eligibility,
 * participation). Only admins may change them; faculty may edit descriptive
 * fields only. CGPA changes feed directly into merit ranking.
 */
const ADMIN_ONLY_STUDENT_FIELDS = ["cgpa", "semesterId", "electiveGroups", "isActive"];

export const update = asyncHandler(async (req, res) => {
  if (req.user.role !== "admin") {
    const blocked = ADMIN_ONLY_STUDENT_FIELDS.filter((f) => f in req.body);
    if (blocked.length > 0) {
      throw ApiError.forbidden(
        `Only an admin may change: ${blocked.join(", ")}.`
      );
    }
  }
  const student = await studentService.updateStudent(req.params.id, req.body);
  return success(res, { student }, "Student updated");
});

export const deactivate = asyncHandler(async (req, res) => {
  const student = await studentService.deactivateStudent(req.params.id);
  return success(res, { student }, "Student deactivated");
});

