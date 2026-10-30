/**
 * src/controllers/preference.controller.js
 */

import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { success } from "../utils/respond.js";
import * as preferenceService from "../services/preference.service.js";
import { ApiError } from "../utils/ApiError.js";

/**
 * Resolve the authenticated student's Student ObjectId. Identity comes only
 * from the authenticated account (req.user.student) — never from the body,
 * query string or URL. Fails closed when the link is missing or malformed so
 * no query is ever built with an undefined student filter.
 */
function requireLinkedStudent(req) {
  if (req.user.role !== "student") {
    throw ApiError.forbidden("Only students can access their own preferences.");
  }
  const studentObjectId = req.user.student;
  if (!studentObjectId || !mongoose.isValidObjectId(studentObjectId)) {
    throw ApiError.badRequest("Your user account is not linked to a student record.");
  }
  return studentObjectId;
}

export const getMyPreferences = asyncHandler(async (req, res) => {
  const studentObjectId = requireLinkedStudent(req);
  const { semesterId, electiveGroup } = req.query;

  const preferences = await preferenceService.getMyPreference(
    studentObjectId,
    semesterId,
    electiveGroup
  );
  return success(res, { preferences }, "Preferences retrieved");
});

export const upsertMyPreference = asyncHandler(async (req, res) => {
  const studentObjectId = requireLinkedStudent(req);

  const preference = await preferenceService.upsertPreference(
    studentObjectId,
    req.body
  );
  return success(res, { preference }, "Preference saved");
});

export const listAll = asyncHandler(async (req, res) => {
  const result = await preferenceService.listAllPreferences(req.query);
  return success(res, result, "All preferences retrieved");
});

export const getOne = asyncHandler(async (req, res) => {
  const preference = await preferenceService.getPreferenceById(req.params.id);
  return success(res, { preference }, "Preference retrieved");
});

