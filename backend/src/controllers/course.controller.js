/**
 * src/controllers/course.controller.js
 */

import { asyncHandler } from "../utils/asyncHandler.js";
import { success, created } from "../utils/respond.js";
import * as courseService from "../services/course.service.js";

export const list = asyncHandler(async (req, res) => {
  const result = await courseService.listCourses(req.query);
  return success(res, result, "Courses retrieved");
});

export const getOne = asyncHandler(async (req, res) => {
  const course = await courseService.getCourseById(req.params.id);
  return success(res, { course }, "Course retrieved");
});

export const create = asyncHandler(async (req, res) => {
  const course = await courseService.createCourse(req.body);
  return created(res, { course }, "Course created");
});

export const update = asyncHandler(async (req, res) => {
  const course = await courseService.updateCourse(req.params.id, req.body);
  return success(res, { course }, "Course updated");
});

export const deactivate = asyncHandler(async (req, res) => {
  const course = await courseService.deactivateCourse(req.params.id);
  return success(res, { course }, "Course deactivated");
});

