/**
 * src/services/publishedResults.service.js
 * Read-only access to PUBLISHED allocation results for students and any
 * logged-in user. Nothing here ever returns proposed (unpublished) data,
 * other students' assignments, CGPAs or input snapshots.
 */

import mongoose from "mongoose";
import Student from "../models/Student.js";
import AllocationRun from "../models/AllocationRun.js";
import Allocation from "../models/Allocation.js";
import { ApiError } from "../utils/ApiError.js";

/** Newest published run of a semester, or null. */
async function findPublishedRun(semesterId) {
  return AllocationRun.findOne({ semesterId, status: "published" })
    .sort({ publishedAt: -1 })
    .select("semesterId selectedAlgorithm publishedAt configuration.maxCoursesPerStudent")
    .lean();
}

function runInfo(run) {
  return {
    id: run._id,
    semesterId: run.semesterId,
    algorithm: run.selectedAlgorithm,
    publishedAt: run.publishedAt,
  };
}

/**
 * Published run of a semester (public to any logged-in user).
 * @returns {{ semesterId: string, published: boolean, run: object|null }}
 */
export async function getPublishedRunInfo(semesterId) {
  const run = await findPublishedRun(semesterId);
  return { semesterId, published: Boolean(run), run: run ? runInfo(run) : null };
}

/**
 * The logged-in student's own published assignments.
 * The semester is the student's own semesterId; identity comes only from the
 * session (studentObjectId = req.user.student), never from client input.
 */
export async function getMyPublishedResults(studentObjectId) {
  if (!studentObjectId || !mongoose.isValidObjectId(studentObjectId)) {
    throw ApiError.badRequest("Your user account is not linked to a student record.");
  }

  const student = await Student.findById(studentObjectId)
    .select("studentId name semesterId")
    .lean();
  if (!student) {
    throw ApiError.badRequest("Your user account is not linked to a student record.");
  }

  const base = {
    student: { studentId: student.studentId, name: student.name },
    semesterId: student.semesterId,
  };

  const run = student.semesterId ? await findPublishedRun(student.semesterId) : null;
  if (!run) {
    return { ...base, published: false, run: null, assignments: [], summary: null };
  }

  const rows = await Allocation.find({
    run: run._id,
    student: student._id,
    algorithm: run.selectedAlgorithm,
    status: "published",
  })
    .populate("course", "courseCode title electiveGroup")
    .sort({ preferenceRank: 1 })
    .lean();

  const assignments = rows.map((a) => ({
    course: {
      courseCode: a.course?.courseCode ?? null,
      title: a.course?.title ?? null,
      electiveGroup: a.electiveGroup ?? a.course?.electiveGroup ?? null,
    },
    preferenceRank: a.preferenceRank,
    phase: a.phase ?? null,
  }));

  return {
    ...base,
    published: true,
    run: runInfo(run),
    assignments,
    summary: {
      coursesAllocated: assignments.length,
      maxCoursesPerStudent: run.configuration?.maxCoursesPerStudent ?? null,
      message:
        assignments.length === 0
          ? "No course was allocated to you in this run."
          : null,
    },
  };
}
