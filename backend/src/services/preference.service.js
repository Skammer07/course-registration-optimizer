/**
 * src/services/preference.service.js
 * Business logic for student preference submission and retrieval.
 *
 * STUDENT ELIGIBILITY:
 *   The student's electiveGroups array (on the Student document) must contain
 *   the requested electiveGroup before preferences are accepted. This prevents
 *   students from submitting preferences for groups they are not enrolled in.
 *   NOTE: If a student has an empty electiveGroups array (not yet configured by
 *   admin), submission is still allowed but a warning is documented below.
 *   See docs/allocation-rules.md for the unresolved policy on group assignment.
 *
 * SEMESTER ELIGIBILITY:
 *   The student's own semesterId must equal the requested semester.
 *   LIMITATION: eligibility by department/programme/academic year is not
 *   modelled (docs/allocation-rules.md is unfilled), so it is not enforced.
 *
 * RANK LIMITS:
 *   No maximum-preferences-per-group policy is documented, so none is
 *   invented. A list is naturally bounded by the number of active courses in
 *   the group (duplicates and out-of-group courses are rejected). Rank is the
 *   array position, so ranks are contiguous from 1 by construction.
 *
 * PREFERENCE IDENTITY:
 *   The student's identity is derived exclusively from the authenticated
 *   session (req.user.student ObjectId). Client-supplied student IDs are
 *   never used to establish ownership.
 */

import mongoose from "mongoose";
import Preference from "../models/Preference.js";
import Course from "../models/Course.js";
import Student from "../models/Student.js";
import { ApiError } from "../utils/ApiError.js";
import { assertPreferencesOpen } from "./semester.service.js";

/**
 * Validates that all course IDs in rankedCourseIds:
 * 1. Exist in the database
 * 2. Are active
 * 3. Belong to the correct semesterId
 * 4. Belong to the correct electiveGroup
 */
async function validateCourseIds(rankedCourseIds, semesterId, electiveGroup) {
  const courses = await Course.find({
    _id: { $in: rankedCourseIds },
  }).lean();

  if (courses.length !== rankedCourseIds.length) {
    throw ApiError.badRequest(
      "One or more course IDs are invalid or do not exist."
    );
  }

  for (const course of courses) {
    if (!course.isActive) {
      throw ApiError.badRequest(
        `Course "${course.courseCode}" is not active.`
      );
    }
    if (course.semesterId !== semesterId) {
      throw ApiError.badRequest(
        `Course "${course.courseCode}" does not belong to semester "${semesterId}".`
      );
    }
    if (course.electiveGroup !== electiveGroup) {
      throw ApiError.badRequest(
        `Course "${course.courseCode}" does not belong to elective group "${electiveGroup}".`
      );
    }
  }

  return courses;
}

/**
 * Get a student's own preference for a semester+group.
 */
export async function getMyPreference(studentObjectId, semesterId, electiveGroup) {
  // Defense in depth: never build a query without a valid student filter.
  if (!studentObjectId || !mongoose.isValidObjectId(studentObjectId)) {
    throw ApiError.forbidden("A valid linked student record is required.");
  }
  const filter = { student: studentObjectId };
  if (semesterId) filter.semesterId = semesterId;
  if (electiveGroup) filter.electiveGroup = electiveGroup;

  const preferences = await Preference.find(filter)
    .populate("rankedCourseIds", "courseCode title semesterId electiveGroup")
    .lean();
  return preferences;
}

/**
 * Upsert a student's preference list.
 *
 * Validates:
 *  1. The student is eligible for the requested electiveGroup (if the student
 *     has a non-empty electiveGroups array).
 *  2. All courses exist, are active, belong to the correct semester and group.
 *  3. No duplicate course IDs (enforced by Zod at the HTTP layer and again here).
 *
 * Uses findOneAndUpdate for safe concurrent updates (the compound unique index
 * on {student, semesterId, electiveGroup} prevents duplicate submissions).
 */
export async function upsertPreference(studentObjectId, data) {
  const { semesterId, electiveGroup, rankedCourseIds, status } = data;

  // Load the student record to check eligibility
  const student = await Student.findById(studentObjectId).lean();
  if (!student) {
    throw ApiError.badRequest("Student record not found for your account.");
  }
  if (student.isActive === false) {
    throw ApiError.forbidden("Your student record is not active.");
  }

  // Semester eligibility: the student's registered semester (authoritative DB
  // value) must match the requested one. Fails closed when no semester is set.
  if (!student.semesterId || student.semesterId !== semesterId) {
    throw ApiError.forbidden(
      `You are not registered for semester "${semesterId}".`
    );
  }

  // Eligibility check: if the student has a non-empty electiveGroups list,
  // the requested group must be in it.
  // UNRESOLVED RULE: What if electiveGroups is empty? Currently we allow it
  // and document the assumption. See docs/allocation-rules.md.
  if (
    student.electiveGroups &&
    student.electiveGroups.length > 0 &&
    !student.electiveGroups.includes(electiveGroup)
  ) {
    throw ApiError.forbidden(
      `You are not eligible for elective group "${electiveGroup}". ` +
        `Your permitted groups are: ${student.electiveGroups.join(", ")}.`
    );
  }

  // Deadline: no edits (draft or submitted) outside the preference window.
  await assertPreferencesOpen(semesterId);

  const uniqueIds = new Set(rankedCourseIds.map(String));
  if (uniqueIds.size !== rankedCourseIds.length) {
    throw ApiError.badRequest("Duplicate course IDs are not allowed.");
  }

  // Convert string IDs to ObjectIds for consistent comparison
  const courseObjectIds = rankedCourseIds.map(
    (id) => new mongoose.Types.ObjectId(id)
  );

  await validateCourseIds(courseObjectIds, semesterId, electiveGroup);

  const update = {
    rankedCourseIds: courseObjectIds,
    status,
    ...(status === "submitted" ? { submittedAt: new Date() } : {}),
  };

  const preference = await Preference.findOneAndUpdate(
    { student: studentObjectId, semesterId, electiveGroup },
    { $set: update },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  )
    .populate("rankedCourseIds", "courseCode title")
    .lean();

  return preference;
}

/**
 * List all preferences (admin/faculty).
 */
export async function listAllPreferences({ semesterId, electiveGroup, status, page, limit }) {
  const filter = {};
  if (semesterId) filter.semesterId = semesterId;
  if (electiveGroup) filter.electiveGroup = electiveGroup;
  if (status) filter.status = status;

  const skip = (page - 1) * limit;
  const [preferences, total] = await Promise.all([
    Preference.find(filter)
      .populate("student", "studentId name cgpa department")
      .populate("rankedCourseIds", "courseCode title")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Preference.countDocuments(filter),
  ]);

  return { preferences, total, page, limit, totalPages: Math.ceil(total / limit) };
}

/**
 * Get a single preference by ID (admin/faculty).
 */
export async function getPreferenceById(id) {
  const preference = await Preference.findById(id)
    .populate("student", "studentId name cgpa department")
    .populate("rankedCourseIds", "courseCode title electiveGroup")
    .lean();
  if (!preference) throw ApiError.notFound("Preference");
  return preference;
}


