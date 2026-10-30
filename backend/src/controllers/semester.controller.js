/**
 * src/controllers/semester.controller.js
 */

import { asyncHandler } from "../utils/asyncHandler.js";
import { success, created } from "../utils/respond.js";
import { ApiError } from "../utils/ApiError.js";
import Student from "../models/Student.js";
import * as semesters from "../services/semester.service.js";
import { getCourseDemand } from "../services/dataOverview.service.js";

export const list = asyncHandler(async (_req, res) => {
  const items = await semesters.listSemesters();
  return success(res, { semesters: items }, "Semesters retrieved");
});

/** Every semester that has data or a record, with counts (for pickers). */
export const overview = asyncHandler(async (_req, res) => {
  const items = await semesters.listSemesterOverview();
  return success(res, { semesters: items }, "Semester overview retrieved");
});

/** How many students ranked each course of the semester (submitted lists only). */
export const demand = asyncHandler(async (req, res) => {
  const result = await getCourseDemand(req.params.semesterId);
  return success(res, result, "Course demand retrieved");
});

export const create = asyncHandler(async (req, res) => {
  const semester = await semesters.createSemester(req.body);
  return created(res, { semester }, "Semester created");
});

export const update = asyncHandler(async (req, res) => {
  const semester = await semesters.updateSemester(req.params.semesterId, req.body);
  return success(res, { semester }, "Semester updated");
});

export const setPreferencesState = asyncHandler(async (req, res) => {
  const semester = await semesters.setPreferencesState(req.params.semesterId, req.body.state);
  return success(res, { semester }, `Preferences set to "${req.body.state}"`);
});

/**
 * Status for the UI. Students may only read their own semester; "me" resolves
 * to the logged-in student's semester.
 */
export const status = asyncHandler(async (req, res) => {
  let { semesterId } = req.params;

  if (req.user.role === "student") {
    const own = req.user.student
      ? await Student.findById(req.user.student).select("semesterId").lean()
      : null;
    if (!own?.semesterId) {
      throw ApiError.badRequest("Your account is not linked to a student with a semester.");
    }
    if (semesterId === "me") semesterId = own.semesterId;
    if (semesterId !== own.semesterId) {
      throw ApiError.forbidden("You can only view the status of your own semester.");
    }
  } else if (semesterId === "me") {
    throw ApiError.badRequest("'me' is only available to student accounts; pass a semesterId.");
  }

  const data = await semesters.getSemesterStatus(semesterId);
  return success(res, data, "Semester status retrieved");
});
