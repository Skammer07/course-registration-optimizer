/**
 * src/controllers/import.controller.js
 * CSV bulk import (admin).
 */

import { asyncHandler } from "../utils/asyncHandler.js";
import { success } from "../utils/respond.js";
import { logger } from "../utils/logger.js";
import * as imports from "../services/import.service.js";

const message = (what, r) =>
  r.dryRun ? `Dry run: ${what} validated, nothing was written` : `${what} imported`;

export const students = asyncHandler(async (req, res) => {
  const { dryRun, onExisting, createLogins } = req.query;
  logger.info({ userId: req.user._id, dryRun, onExisting, createLogins }, "Student CSV import requested");
  const result = await imports.importStudents(req.body, { dryRun, onExisting, createLogins });
  // may contain one-time temporary passwords
  res.set("Cache-Control", "no-store");
  return success(res, result, message("Students", result));
});

export const courses = asyncHandler(async (req, res) => {
  const { dryRun, onExisting } = req.query;
  logger.info({ userId: req.user._id, dryRun, onExisting }, "Course CSV import requested");
  const result = await imports.importCourses(req.body, { dryRun, onExisting });
  return success(res, result, message("Courses", result));
});

export const preferences = asyncHandler(async (req, res) => {
  const { dryRun, onExisting, status } = req.query;
  logger.info({ userId: req.user._id, dryRun, onExisting, status }, "Preference CSV import requested");
  const result = await imports.importPreferences(req.body, { dryRun, onExisting, status });
  return success(res, result, message("Preferences", result));
});
