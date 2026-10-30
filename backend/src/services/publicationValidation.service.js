/**
 * src/services/publicationValidation.service.js
 *
 * Re-validates the ACTUAL persisted assignments of one algorithm of one run
 * immediately before publication. It never trusts the run's cached metrics or
 * stored validation summary on their own; those are only cross-checked
 * against what is really in the Allocation collection.
 *
 * Source of truth for rules/inputs: the run's immutable inputSnapshot
 * (students, courses, preferences, timetable, configuration) — NOT the live
 * Student/Course documents, which may have been edited since the run. Live
 * documents are used only to resolve the stored ObjectId references.
 *
 * Mandatory constraints enforced (the algorithm's shared validateAllocation,
 * identical for baseline and optimized):
 *   unknown student/course, duplicates, selection from the student's own
 *   preferences, course capacity, maximum courses per student, timetable
 *   clashes. Added here: reference integrity, run/semester match, elective-
 *   group consistency, preference-rank consistency, non-empty result,
 *   stale-metric detection.
 *
 * NOT enforced because no rule is documented (docs/allocation-rules.md is
 * unfilled): compulsory/required courses, required electives per group,
 * per-group quotas, prerequisites, reserved seats, strict CGPA priority.
 * A zero-assignment publication is not defined as valid, so it is rejected.
 */

import Allocation from "../models/Allocation.js";
import Student from "../models/Student.js";
import Course from "../models/Course.js";
import { getAllocationValidator } from "./allocationEngine.service.js";

const MAX_ERRORS = 50;

/**
 * Pure validation of already-loaded data.
 *
 * @param {object} p
 * @param {object} p.run             Lean AllocationRun
 * @param {"baseline"|"optimized"} p.algorithm
 * @param {object[]} p.allocations   Lean Allocation docs of (run, algorithm)
 * @param {Map<string,object>} p.studentsById  String(_id) -> Student doc
 * @param {Map<string,object>} p.coursesById   String(_id) -> Course doc
 * @param {Function} p.validateAllocation  Shared algorithm validator
 * @returns {{ valid: boolean, errors: string[], assignmentCount: number }}
 */
export function validateStoredAssignments({
  run,
  algorithm,
  allocations,
  studentsById,
  coursesById,
  validateAllocation,
}) {
  const errors = [];
  const snap = run.inputSnapshot;

  if (
    !snap ||
    !Array.isArray(snap.students) ||
    !Array.isArray(snap.courses) ||
    !Array.isArray(snap.preferences)
  ) {
    return {
      valid: false,
      errors: ["The run has no complete immutable input snapshot; it cannot be verified."],
      assignmentCount: allocations.length,
    };
  }

  if (allocations.length === 0) {
    errors.push(
      `No stored assignments exist for the "${algorithm}" algorithm of this run; ` +
        "publishing an empty result is not permitted."
    );
  }

  // 1. Resolve references and check run/algorithm/semester consistency.
  const mapped = [];
  allocations.forEach((a, i) => {
    const label = `Assignment ${i + 1}`;
    if (String(a.run) !== String(run._id)) {
      errors.push(`${label}: belongs to a different run.`);
    }
    if (a.algorithm !== algorithm) {
      errors.push(`${label}: belongs to the "${a.algorithm}" algorithm, not "${algorithm}".`);
    }
    const student = studentsById.get(String(a.student));
    const course = coursesById.get(String(a.course));
    if (!student) errors.push(`${label}: references a missing student record.`);
    if (!course) errors.push(`${label}: references a missing course record.`);
    if (course && course.semesterId !== run.semesterId) {
      errors.push(`${label}: course "${course.courseCode}" is not in semester "${run.semesterId}".`);
    }
    if (student && course) {
      mapped.push({
        studentId: student.studentId,
        courseId: course.courseCode,
        preferenceRank: a.preferenceRank ?? null,
      });
    }
  });

  // 2. Shared mandatory constraints against the immutable snapshot.
  try {
    const result = validateAllocation({
      students: snap.students,
      courses: snap.courses,
      preferences: snap.preferences,
      allocations: mapped,
      timetable: snap.timetable ?? null,
      maxCoursesPerStudent: run.configuration?.maxCoursesPerStudent ?? 2,
    });
    errors.push(...result.errors);
  } catch (err) {
    errors.push(`Constraint validation could not be completed: ${String(err.message).slice(0, 200)}`);
  }

  // 3. Elective-group and rank consistency against the snapshot.
  const courseGroup = new Map(snap.courses.map((c) => [c.id, c.electiveGroup]));
  const prefByPair = new Map(
    snap.preferences.map((p) => [`${p.studentId}::${p.courseId}`, p])
  );
  for (const a of mapped) {
    const pref = prefByPair.get(`${a.studentId}::${a.courseId}`);
    if (!pref) continue; // already reported by the shared validator
    const group = courseGroup.get(a.courseId);
    if (pref.electiveGroup != null && group != null && pref.electiveGroup !== group) {
      errors.push(
        `Student "${a.studentId}": course "${a.courseId}" is in group "${group}" ` +
          `but was selected under group "${pref.electiveGroup}".`
      );
    }
    if (a.preferenceRank != null && a.preferenceRank !== pref.rank) {
      errors.push(
        `Student "${a.studentId}" / course "${a.courseId}": stored rank ${a.preferenceRank} ` +
          `does not match the snapshot rank ${pref.rank}.`
      );
    }
  }

  // 4. Cached summaries must agree with the real records (stale detection).
  const metrics = algorithm === "optimized" ? run.optimizedMetrics : run.baselineMetrics;
  const summary = algorithm === "optimized" ? run.optimizedValidation : run.baselineValidation;
  if (!metrics || !summary) {
    errors.push("Stored metrics or validation summary are missing for this algorithm.");
  } else {
    if (typeof metrics.totalAssignments === "number" && metrics.totalAssignments !== allocations.length) {
      errors.push(
        `Stored metrics are stale: they report ${metrics.totalAssignments} assignments ` +
          `but ${allocations.length} are stored.`
      );
    }
    if ((metrics.constraintViolations ?? 1) > 0) {
      errors.push(`Stored metrics report ${metrics.constraintViolations ?? "unknown"} constraint violation(s).`);
    }
    if (summary.valid !== true) {
      errors.push("The stored validation summary did not pass.");
    }
  }

  const capped = errors.slice(0, MAX_ERRORS);
  return { valid: errors.length === 0, errors: capped, assignmentCount: allocations.length };
}

/**
 * Load the selected algorithm's persisted assignments and the referenced
 * Student/Course documents, then validate them.
 */
export async function validateRunForPublication(run, algorithm) {
  const allocations = await Allocation.find({ run: run._id, algorithm }).lean();

  const studentIds = [...new Set(allocations.map((a) => String(a.student)))];
  const courseIds = [...new Set(allocations.map((a) => String(a.course)))];
  const [students, courses] = await Promise.all([
    Student.find({ _id: { $in: studentIds } }).lean(),
    Course.find({ _id: { $in: courseIds } }).lean(),
  ]);

  return validateStoredAssignments({
    run,
    algorithm,
    allocations,
    studentsById: new Map(students.map((s) => [String(s._id), s])),
    coursesById: new Map(courses.map((c) => [String(c._id), c])),
    validateAllocation: await getAllocationValidator(),
  });
}
