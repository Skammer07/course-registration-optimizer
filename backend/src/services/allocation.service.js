/**
 * src/services/allocation.service.js
 * Orchestrates the full allocation workflow:
 * 1. Load data from MongoDB
 * 2. Invoke the algorithm via allocationEngine.service.js
 * 3. Validate the algorithm output and persist AllocationRun + Allocation records
 * 4. Return the run summary
 *
 * PERSISTENCE (works on a standalone MongoDB, no transactions required):
 *   - The run is created as "running", the algorithm executes with no
 *     transaction or lock held, the output is validated (malformed records
 *     are REJECTED, never silently dropped), assignments are inserted, counts
 *     are verified, and only then does a conditional update move the run to
 *     "completed". Any failure deletes everything inserted for the run and
 *     marks it "failed", so a run is never "completed" with partial data.
 *
 * PUBLISH DESIGN: see publishAllocationRun below (state machine, idempotency,
 *   concurrency policy).
 *
 * INPUT SNAPSHOT:
 *   - The full normalized inputs (students, courses incl. elective group,
 *     preferences incl. elective group, timetable) used by the algorithm are
 *     stored on the run, together with the configuration, algorithmVersion
 *     and the random seed of the baseline lottery.
 *   - Later edits to Student/Course/Preference documents cannot change the
 *     historical meaning of a stored run.
 */

import { performance } from "node:perf_hooks";
import mongoose from "mongoose";
import Student from "../models/Student.js";
import Course from "../models/Course.js";
import Preference from "../models/Preference.js";
import AllocationRun from "../models/AllocationRun.js";
import Allocation from "../models/Allocation.js";
import {
  runComparison,
  runSingle,
  fingerprintInput,
  prepareInputs,
  buildFixedTimetable,
  isCompulsoryCourse,
} from "./allocationEngine.service.js";
import { preferenceWindowWarning, closePreferencesAfterPublish } from "./semester.service.js";
import { largeTimetableRunWarning } from "../utils/runAdvisories.js";
import { validateRunForPublication } from "./publicationValidation.service.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../utils/logger.js";

/**
 * Execute an allocation comparison for a semester.
 * Loads data from MongoDB, calls the algorithm, and persists results.
 *
 * @param {object} params
 * @param {string} params.semesterId
 * @param {number} params.maxCoursesPerStudent
 * @param {number} params.meritRatio
 * @param {number} params.randomRatio
 * @param {boolean} params.includeTimetable
 * @param {number} [params.seed]            Baseline lottery seed (generated if omitted)
 * @param {string} params.createdByUserId   ObjectId string of the requesting admin
 * @returns {Promise<object>}  The persisted AllocationRun document
 */
export async function executeAllocationComparison({
  semesterId,
  maxCoursesPerStudent = 2,
  meritRatio = 0.7,
  randomRatio = 0.3,
  includeTimetable = true,
  optimizerFloor = "baseline",
  cgpaPriority = true,
  seed,
  createdByUserId,
}) {
  // 1. Load data from MongoDB
  let [students, courses, preferences] = await Promise.all([
    Student.find({ semesterId, isActive: true }).lean(),
    Course.find({ semesterId, isActive: true }).lean(),
    Preference.find({ semesterId, status: "submitted" })
      .populate("student", "studentId name cgpa department")
      .populate("rankedCourseIds", "courseCode title electiveGroup semesterId")
      .lean(),
  ]);

  // Compulsory courses are not allocated; they only fix part of each
  // student's week so electives that overlap them are never given.
  const compulsoryCourses = courses.filter(isCompulsoryCourse);
  courses = courses.filter((c) => !isCompulsoryCourse(c));

  if (students.length === 0) {
    throw ApiError.badRequest(
      `No active students found for semester "${semesterId}".`
    );
  }
  if (courses.length === 0) {
    throw ApiError.badRequest(
      `No active courses found for semester "${semesterId}".`
    );
  }
  if (preferences.length === 0) {
    throw ApiError.badRequest(
      `No submitted preferences found for semester "${semesterId}".`
    );
  }

  // Exclude stale records (and report them) instead of letting one crash the run.
  const prepared = prepareInputs({ students, courses, preferences, includeTimetable });
  preferences = prepared.preferences;
  const inputWarnings = prepared.warnings;
  const windowWarning = await preferenceWindowWarning(semesterId);
  if (windowWarning) inputWarnings.messages = [windowWarning, ...inputWarnings.messages];
  const sizeWarning = largeTimetableRunWarning({
    studentCount: students.length,
    includeTimetable,
    includesOptimizer: true,
  });
  if (sizeWarning) inputWarnings.messages = [...inputWarnings.messages, sizeWarning];

  const fixed = includeTimetable
    ? buildFixedTimetable({ students, compulsoryCourses })
    : { fixedTimetable: null, messages: [] };
  inputWarnings.messages = [...inputWarnings.messages, ...fixed.messages];

  // 2. Create a run record BEFORE calling the algorithm
  //    (so we can mark it as failed if anything below throws)
  const run = await AllocationRun.create({
    semesterId,
    status: "running",
    inputWarnings,
    configuration: { maxCoursesPerStudent, meritRatio, randomRatio, timetableValidationEnabled: includeTimetable, oneCoursePerGroup: true, optimizerFloor, cgpaPriority },
    // Counts only; the full normalized snapshot is stored when the run completes
    inputSnapshot: {
      studentCount: students.length,
      courseCount: courses.length,
      preferenceCount: preferences.length,
      timetableIncluded: includeTimetable,
    },
    createdBy: new mongoose.Types.ObjectId(createdByUserId),
  });

  logger.info({ runId: run._id, semesterId }, "Allocation run started");

  // Any failure from here on leaves NO assignments behind and a "failed" run.
  const failRun = async (summary) => {
    try {
      await Allocation.deleteMany({ run: run._id });
    } catch (cleanupErr) {
      logger.error({ runId: run._id, err: cleanupErr.message }, "Allocation cleanup failed");
    }
    // Conditional: a run an admin already cancelled must stay "cancelled".
    await AllocationRun.updateOne(
      { _id: run._id, status: "running" },
      { $set: { status: "failed", errorSummary: String(summary).slice(0, 2000) } }
    );
  };

  // 3. Invoke the algorithm. No database transaction or lock is held while
  //    the (potentially expensive) computation runs.
  let comparisonResult;
  try {
    const startMs = performance.now();
    const { result, inputSnapshot } = await runComparison({
      students,
      courses,
      preferences,
      includeTimetable,
      fixedTimetable: fixed.fixedTimetable,
      options: { maxCoursesPerStudent, meritRatio, randomRatio, seed, optimizerFloor, cgpaPriority },
      runId: String(run._id),
    });
    const totalRuntimeMs = Number((performance.now() - startMs).toFixed(3));
    comparisonResult = { result, inputSnapshot, totalRuntimeMs };
  } catch (err) {
    await failRun(err.message);
    logger.error({ runId: run._id, err: err.message }, "Allocation run failed");
    if (err.code === "ERR_WORKER_OUT_OF_MEMORY") {
      throw new ApiError(
        500,
        "The allocation ran out of memory and was stopped. The run has been recorded as failed. " +
          "Try a smaller dataset, or disable timetable validation.",
        "ALLOCATION_OUT_OF_MEMORY"
      );
    }
    if (err.code === "ALLOCATION_CANCELLED") {
      throw new ApiError(409, "The allocation run was cancelled.", "ALLOCATION_CANCELLED");
    }
    if (err.code === "ALLOCATION_TIMEOUT") {
      throw new ApiError(
        504,
        "The allocation exceeded its time limit and was stopped. The run has been recorded as failed. " +
          "Try a smaller dataset, or disable timetable validation.",
        "ALLOCATION_TIMEOUT"
      );
    }
    throw new ApiError(
      500,
      "The allocation algorithm encountered an error. The run has been recorded as failed.",
      "ALLOCATION_FAILED"
    );
  }

  // 4. Validate the algorithm output, then persist it.
  //    Malformed records are rejected, never silently dropped, so the stored
  //    assignment set always equals the set the metrics describe.
  try {
    const { result, inputSnapshot } = comparisonResult;

    const studentMap = new Map(students.map((s) => [s.studentId, s._id]));
    const courseMap = new Map(courses.map((c) => [c.courseCode, c._id]));

    const baselineDocs = buildAllocationDocs(run._id, "baseline", result.baseline, studentMap, courseMap);
    const optimizedDocs = buildAllocationDocs(run._id, "optimized", result.optimized, studentMap, courseMap);

    // Without transactions (standalone MongoDB) atomicity comes from:
    // insert -> verify counts -> conditional status transition; any failure
    // deletes everything inserted for this run (failRun).
    const expected = baselineDocs.length + optimizedDocs.length;
    if (expected > 0) {
      await Allocation.insertMany([...baselineDocs, ...optimizedDocs], { ordered: true });
    }
    const persisted = await Allocation.countDocuments({ run: run._id });
    if (persisted !== expected) {
      throw new Error(`Persisted ${persisted} of ${expected} assignments.`);
    }

    const updatedRun = await AllocationRun.findOneAndUpdate(
      { _id: run._id, status: "running" },
      {
        status: "completed",
        algorithmVersion: result.configuration?.algorithmVersion,
        randomSeed: result.configuration?.randomSeed ?? null,
        algorithmsRun: ["baseline", "optimized"],
        inputFingerprint: fingerprintInput(inputSnapshot),
        baselineMetrics: result.baseline.metrics,
        optimizedMetrics: result.optimized.metrics,
        baselineValidation: {
          valid: result.baseline.validation.valid,
          errorCount: result.baseline.validation.errors.length,
          errorList: result.baseline.validation.errors.slice(0, 20),
        },
        optimizedValidation: {
          valid: result.optimized.validation.valid,
          errorCount: result.optimized.validation.errors.length,
          errorList: result.optimized.validation.errors.slice(0, 20),
        },
        comparison: result.comparison,
        algorithmDetails: {
          baseline: {
            phaseSummary: result.baseline.phaseSummary ?? null,
            assumptions: result.baseline.assumptions ?? null,
          },
          optimized: {
            assumptions: result.optimized.assumptions ?? null,
            totalPreferenceCost: result.optimized.totalPreferenceCost ?? null,
          },
        },
        baselineRuntimeMs: result.baseline.runtimeMs,
        optimizedRuntimeMs: result.optimized.runtimeMs,
        totalRuntimeMs: comparisonResult.totalRuntimeMs,
        // Full normalized snapshot (incl. elective-group identity) so the run
        // stays reproducible after later edits to live documents.
        inputSnapshot: {
          studentCount: inputSnapshot.algStudents.length,
          courseCount: inputSnapshot.algCourses.length,
          preferenceCount: inputSnapshot.algPreferences.length,
          timetableIncluded: includeTimetable,
          students: inputSnapshot.algStudents,
          courses: inputSnapshot.algCourses,
          preferences: inputSnapshot.algPreferences,
          timetable: inputSnapshot.timetable ?? null,
          fixedTimetable: inputSnapshot.fixedTimetable ?? null,
        },
      },
      { new: true }
    ).lean();

    if (!updatedRun) {
      throw new Error("Run was no longer in the running state.");
    }

    logger.info(
      { runId: run._id, semesterId, totalRuntimeMs: comparisonResult.totalRuntimeMs },
      "Allocation run completed"
    );
    return updatedRun;
  } catch (err) {
    await failRun(`Persistence failed: ${err.message}`);
    logger.error({ runId: run._id, err: err.message }, "Allocation persistence failed");
    throw new ApiError(500, "Failed to persist allocation results.", "PERSISTENCE_FAILED");
  }
}

/**
 * Run ONE selected algorithm ("baseline" or "optimized") for a semester and
 * persist it as its own run. Same safety rules as executeAllocationComparison:
 * validate output, insert, verify counts, conditional transition to
 * "completed", cleanup + "failed" on any error. Ratios/seed apply to the
 * baseline only and are stored as null for the optimizer.
 */
export async function executeSingleAllocation({
  semesterId,
  algorithm,
  maxCoursesPerStudent = 2,
  meritRatio,
  randomRatio,
  includeTimetable = true,
  optimizerFloor = "baseline",
  cgpaPriority = true,
  seed,
  createdByUserId,
}) {
  const isBaseline = algorithm === "baseline";
  // the optimizer is held to a baseline result unless told otherwise, so it needs the split and seed too
  const usesBaseline = isBaseline || optimizerFloor === "baseline";
  const rounded = (x) => Number(x.toFixed(10)); // 1 - 0.7 is 0.30000000000000004 in floating point
  const merit = usesBaseline ? (meritRatio ?? (randomRatio !== undefined ? rounded(1 - randomRatio) : 0.7)) : null;
  const random = usesBaseline ? (randomRatio ?? rounded(1 - merit)) : null;

  let [students, courses, preferences] = await Promise.all([
    Student.find({ semesterId, isActive: true }).lean(),
    Course.find({ semesterId, isActive: true }).lean(),
    Preference.find({ semesterId, status: "submitted" })
      .populate("student", "studentId name cgpa department")
      .populate("rankedCourseIds", "courseCode title electiveGroup semesterId")
      .lean(),
  ]);

  const compulsoryCourses = courses.filter(isCompulsoryCourse);
  courses = courses.filter((c) => !isCompulsoryCourse(c));

  if (students.length === 0) {
    throw ApiError.badRequest(`No active students found for semester "${semesterId}".`);
  }
  if (courses.length === 0) {
    throw ApiError.badRequest(`No active courses found for semester "${semesterId}".`);
  }
  if (preferences.length === 0) {
    throw ApiError.badRequest(`No submitted preferences found for semester "${semesterId}".`);
  }

  // Exclude stale records (and report them) instead of letting one crash the run.
  const prepared = prepareInputs({ students, courses, preferences, includeTimetable });
  preferences = prepared.preferences;
  const inputWarnings = prepared.warnings;
  const windowWarning = await preferenceWindowWarning(semesterId);
  if (windowWarning) inputWarnings.messages = [windowWarning, ...inputWarnings.messages];
  const sizeWarning = largeTimetableRunWarning({
    studentCount: students.length,
    includeTimetable,
    includesOptimizer: algorithm === "optimized",
  });
  if (sizeWarning) inputWarnings.messages = [...inputWarnings.messages, sizeWarning];

  const fixed = includeTimetable
    ? buildFixedTimetable({ students, compulsoryCourses })
    : { fixedTimetable: null, messages: [] };
  inputWarnings.messages = [...inputWarnings.messages, ...fixed.messages];

  const run = await AllocationRun.create({
    semesterId,
    status: "running",
    inputWarnings,
    algorithmsRun: [algorithm],
    configuration: {
      maxCoursesPerStudent,
      meritRatio: merit,
      randomRatio: random,
      timetableValidationEnabled: includeTimetable,
      oneCoursePerGroup: true,
      optimizerFloor: isBaseline ? null : optimizerFloor,
      cgpaPriority: isBaseline ? false : cgpaPriority,
    },
    inputSnapshot: {
      studentCount: students.length,
      courseCount: courses.length,
      preferenceCount: preferences.length,
      timetableIncluded: includeTimetable,
    },
    createdBy: new mongoose.Types.ObjectId(createdByUserId),
  });

  logger.info({ runId: run._id, semesterId, algorithm }, "Single-algorithm run started");

  const failRun = async (summary) => {
    try {
      await Allocation.deleteMany({ run: run._id });
    } catch (cleanupErr) {
      logger.error({ runId: run._id, err: cleanupErr.message }, "Allocation cleanup failed");
    }
    // Conditional: a run an admin already cancelled must stay "cancelled".
    await AllocationRun.updateOne(
      { _id: run._id, status: "running" },
      { $set: { status: "failed", errorSummary: String(summary).slice(0, 2000) } }
    );
  };

  let computed;
  try {
    const startMs = performance.now();
    const { result, inputSnapshot } = await runSingle({
      algorithm,
      students,
      courses,
      preferences,
      includeTimetable,
      fixedTimetable: fixed.fixedTimetable,
      options: {
        maxCoursesPerStudent,
        meritRatio: merit ?? undefined,
        randomRatio: random ?? undefined,
        seed,
        optimizerFloor,
        cgpaPriority,
      },
      runId: String(run._id),
    });
    computed = {
      result,
      inputSnapshot,
      totalRuntimeMs: Number((performance.now() - startMs).toFixed(3)),
    };
  } catch (err) {
    await failRun(err.message);
    logger.error({ runId: run._id, err: err.message }, "Single-algorithm run failed");
    if (err.code === "ERR_WORKER_OUT_OF_MEMORY") {
      throw new ApiError(
        500,
        "The allocation ran out of memory and was stopped. The run has been recorded as failed. " +
          "Try a smaller dataset, or disable timetable validation.",
        "ALLOCATION_OUT_OF_MEMORY"
      );
    }
    if (err.code === "ALLOCATION_CANCELLED") {
      throw new ApiError(409, "The allocation run was cancelled.", "ALLOCATION_CANCELLED");
    }
    if (err.code === "ALLOCATION_TIMEOUT") {
      throw new ApiError(
        504,
        "The allocation exceeded its time limit and was stopped. The run has been recorded as failed. " +
          "Try a smaller dataset, or disable timetable validation.",
        "ALLOCATION_TIMEOUT"
      );
    }
    throw new ApiError(
      500,
      "The allocation algorithm encountered an error. The run has been recorded as failed.",
      "ALLOCATION_FAILED"
    );
  }

  try {
    const { result, inputSnapshot } = computed;
    const studentMap = new Map(students.map((x) => [x.studentId, x._id]));
    const courseMap = new Map(courses.map((c) => [c.courseCode, c._id]));

    const docs = buildAllocationDocs(run._id, algorithm, result, studentMap, courseMap);
    if (docs.length > 0) {
      await Allocation.insertMany(docs, { ordered: true });
    }
    const persisted = await Allocation.countDocuments({ run: run._id });
    if (persisted !== docs.length) {
      throw new Error(`Persisted ${persisted} of ${docs.length} assignments.`);
    }

    const prefix = isBaseline ? "baseline" : "optimized";
    const updatedRun = await AllocationRun.findOneAndUpdate(
      { _id: run._id, status: "running" },
      {
        status: "completed",
        algorithmVersion: result.configuration.algorithmVersion,
        randomSeed: result.configuration.randomSeed ?? null,
        inputFingerprint: fingerprintInput(inputSnapshot),
        [`${prefix}Metrics`]: result.metrics,
        [`${prefix}Validation`]: {
          valid: result.validation.valid,
          errorCount: result.validation.errors.length,
          errorList: result.validation.errors.slice(0, 20),
        },
        [`${prefix}RuntimeMs`]: result.runtimeMs,
        algorithmDetails: {
          [prefix]: {
            phaseSummary: result.phaseSummary ?? null,
            assumptions: result.assumptions ?? null,
            totalPreferenceCost: result.totalPreferenceCost ?? null,
          },
        },
        totalRuntimeMs: computed.totalRuntimeMs,
        inputSnapshot: {
          studentCount: inputSnapshot.algStudents.length,
          courseCount: inputSnapshot.algCourses.length,
          preferenceCount: inputSnapshot.algPreferences.length,
          timetableIncluded: includeTimetable,
          students: inputSnapshot.algStudents,
          courses: inputSnapshot.algCourses,
          preferences: inputSnapshot.algPreferences,
          timetable: inputSnapshot.timetable ?? null,
          fixedTimetable: inputSnapshot.fixedTimetable ?? null,
        },
      },
      { new: true }
    ).lean();

    if (!updatedRun) throw new Error("Run was no longer in the running state.");

    logger.info({ runId: run._id, semesterId, algorithm }, "Single-algorithm run completed");
    return updatedRun;
  } catch (err) {
    await failRun(`Persistence failed: ${err.message}`);
    logger.error({ runId: run._id, err: err.message }, "Allocation persistence failed");
    throw new ApiError(500, "Failed to persist allocation results.", "PERSISTENCE_FAILED");
  }
}

const COMPARED_METRICS = [
  "totalAssignments",
  "studentsWithAtLeastOneCourse",
  "studentsWithTwoCourses",
  "unallocatedStudents",
  "capacityUtilization",
  "rank1Assignments",
  "averagePreferenceRank",
  "constraintViolations",
  "timetableClashes",
];

/**
 * Side-by-side comparison of two stored runs (or two algorithms of one run).
 * Read-only: reports each side's numbers and the difference (B minus A); it
 * does not declare a winner. Warns when the inputs or limits differ.
 */
export async function compareRuns({ runA, runB, algorithmA, algorithmB }) {
  const [a, b] = await Promise.all([
    AllocationRun.findById(runA).lean(),
    AllocationRun.findById(runB).lean(),
  ]);
  if (!a) throw ApiError.notFound("Run A");
  if (!b) throw ApiError.notFound("Run B");

  const resolve = (run, requested, label, param) => {
    if (!["completed", "publishing", "published"].includes(run.status)) {
      throw ApiError.badRequest(`${label} is not completed (status: "${run.status}").`);
    }
    const contained = run.algorithmsRun?.length ? run.algorithmsRun : ["baseline", "optimized"];
    let algorithm = requested;
    if (!algorithm) {
      if (contained.length !== 1) {
        throw ApiError.badRequest(`${label} contains both algorithms; specify ${param}.`);
      }
      algorithm = contained[0];
    }
    if (!contained.includes(algorithm)) {
      throw ApiError.badRequest(`${label} has no "${algorithm}" results.`);
    }
    const isOpt = algorithm === "optimized";
    const validation = isOpt ? run.optimizedValidation : run.baselineValidation;
    return {
      runId: run._id,
      semesterId: run.semesterId,
      status: run.status,
      algorithm,
      configuration: run.configuration,
      randomSeed: run.randomSeed ?? null,
      algorithmVersion: run.algorithmVersion,
      metrics: isOpt ? run.optimizedMetrics : run.baselineMetrics,
      runtimeMs: isOpt ? run.optimizedRuntimeMs : run.baselineRuntimeMs,
      validation: validation ? { valid: validation.valid, errorCount: validation.errorCount } : null,
    };
  };

  const sideA = resolve(a, algorithmA, "Run A", "algorithmA");
  const sideB = resolve(b, algorithmB, "Run B", "algorithmB");

  const warnings = [];
  if (a.semesterId !== b.semesterId) warnings.push("The runs are for different semesters.");
  if (!a.inputFingerprint || !b.inputFingerprint) {
    warnings.push("Input fingerprint missing on at least one run; cannot confirm the same input data.");
  } else if (a.inputFingerprint !== b.inputFingerprint) {
    warnings.push(
      "The runs used different input data (students, courses, preferences or timetable); the comparison may not be fair."
    );
  }
  if (a.configuration?.maxCoursesPerStudent !== b.configuration?.maxCoursesPerStudent) {
    warnings.push("The runs used different maxCoursesPerStudent limits.");
  }
  if (a.configuration?.timetableValidationEnabled !== b.configuration?.timetableValidationEnabled) {
    warnings.push("Only one of the runs had timetable validation enabled.");
  }

  const difference = {};
  for (const key of COMPARED_METRICS) {
    const x = sideA.metrics?.[key];
    const y = sideB.metrics?.[key];
    difference[key] = typeof x === "number" && typeof y === "number" ? Number((y - x).toFixed(4)) : null;
  }
  difference.runtimeMs =
    typeof sideA.runtimeMs === "number" && typeof sideB.runtimeMs === "number"
      ? Number((sideB.runtimeMs - sideA.runtimeMs).toFixed(3))
      : null;

  return {
    a: sideA,
    b: sideB,
    difference,
    sameInput: Boolean(a.inputFingerprint && a.inputFingerprint === b.inputFingerprint),
    warnings,
    note:
      "difference = B minus A. Lower is better for averagePreferenceRank, unallocatedStudents and constraintViolations; higher is usually better for assignments. No winner is declared because the algorithms follow different policies (the baseline keeps merit/random quotas; the optimizer maximizes assignments and, when held to the baseline, never leaves a student worse than the baseline's result and uses CGPA among equal results).",
  };
}

/**
 * Validate one algorithm's output and convert it to Allocation documents.
 * Throws (listing the first problems) instead of dropping bad records.
 * Exported for tests.
 */
export function buildAllocationDocs(runId, algorithm, algResult, studentMap, courseMap) {
  const problems = [];
  const allocations = algResult?.allocations;

  if (!Array.isArray(allocations)) {
    throw new Error(`${algorithm}: allocations is not an array.`);
  }

  const seen = new Set();
  const docs = [];
  allocations.forEach((a, i) => {
    const label = `${algorithm} #${i + 1}`;
    if (!a || typeof a !== "object") {
      problems.push(`${label}: not an object`);
      return;
    }
    const student = studentMap.get(a.studentId);
    const course = courseMap.get(a.courseId);
    if (!student) problems.push(`${label}: unknown student "${a.studentId}"`);
    if (!course) problems.push(`${label}: unknown course "${a.courseId}"`);
    if (!Number.isInteger(a.preferenceRank) || a.preferenceRank < 1) {
      problems.push(`${label}: invalid preferenceRank`);
    }
    const key = `${a.studentId}::${a.courseId}`;
    if (seen.has(key)) problems.push(`${label}: duplicate assignment ${key}`);
    seen.add(key);
    if (student && course) {
      docs.push({
        run: runId,
        student,
        course,
        algorithm,
        preferenceRank: a.preferenceRank,
        phase: a.phase ?? null,
        iteration: Number.isInteger(a.iteration) ? a.iteration : null,
        electiveGroup: a.electiveGroup ?? null,
        status: "proposed",
      });
    }
  });

  const reported = algResult.metrics?.totalAssignments;
  if (typeof reported === "number" && reported !== allocations.length) {
    problems.push(
      `${algorithm}: metrics report ${reported} assignments but ${allocations.length} were produced`
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `Invalid ${algorithm} output (${problems.length} problem(s)): ${problems.slice(0, 5).join("; ")}`
    );
  }
  return docs;
}

/**
 * List allocation runs with optional filters.
 * The heavy / sensitive normalized snapshot arrays (student CGPAs etc.) are
 * excluded from listings; fetch a single run for the full snapshot.
 */
export async function listAllocationRuns({ semesterId, status, algorithm, page, limit }) {
  const filter = {};
  if (semesterId) filter.semesterId = semesterId;
  if (status) filter.status = status;
  if (algorithm) filter.algorithmsRun = algorithm;

  const skip = (page - 1) * limit;
  const [runs, total] = await Promise.all([
    AllocationRun.find(filter)
      .select(
        "-inputSnapshot.students -inputSnapshot.courses -inputSnapshot.preferences -inputSnapshot.timetable -inputSnapshot.fixedTimetable"
      )
      .populate("createdBy", "email role")
      .populate("publishedBy", "email role")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AllocationRun.countDocuments(filter),
  ]);

  return { runs, total, page, limit, totalPages: Math.ceil(total / limit) };
}

/**
 * Get a single allocation run by ID.
 * The full inputSnapshot is included for admin/faculty review and
 * reproducibility; the route is restricted to those roles.
 */
export async function getAllocationRunById(runId) {
  const run = await AllocationRun.findById(runId)
    .populate("createdBy", "email role")
    .populate("publishedBy", "email role")
    .lean();
  if (!run) throw ApiError.notFound("Allocation run");
  return run;
}

/**
 * Get paginated assignment records for a run.
 */
export async function getRunResults(
  runId,
  { algorithm, phase, rank, courseCode, studentId, sort = "default", page, limit }
) {
  const run = await AllocationRun.findById(runId).lean();
  if (!run) throw ApiError.notFound("Allocation run");

  const filter = { run: new mongoose.Types.ObjectId(runId) };
  if (algorithm) filter.algorithm = algorithm;
  if (phase) filter.phase = phase;
  if (rank) filter.preferenceRank = rank;

  const empty = { run, allocations: [], total: 0, page, limit, totalPages: 0 };
  if (studentId) {
    const student = await Student.findOne({ studentId: studentId.toUpperCase() }).select("_id").lean();
    if (!student) return empty;
    filter.student = student._id;
  }
  if (courseCode) {
    const course = await Course.findOne({ courseCode, semesterId: run.semesterId }).select("_id").lean();
    if (!course) return empty;
    filter.course = course._id;
  }

  const sorts = {
    default: { algorithm: 1, preferenceRank: 1, _id: 1 },
    rank: { preferenceRank: 1, algorithm: 1, _id: 1 },
    "-rank": { preferenceRank: -1, algorithm: 1, _id: 1 },
    phase: { phase: 1, preferenceRank: 1, _id: 1 },
  };

  const skip = (page - 1) * limit;
  const [allocations, total] = await Promise.all([
    Allocation.find(filter)
      .populate("student", "studentId name cgpa department")
      .populate("course", "courseCode title capacity electiveGroup")
      .sort(sorts[sort] ?? sorts.default)
      .skip(skip)
      .limit(limit)
      .lean(),
    Allocation.countDocuments(filter),
  ]);

  return { run, allocations, total, page, limit, totalPages: Math.ceil(total / limit) };
}

/** A claim older than this is considered abandoned (e.g. the process crashed). */
export const PUBLISH_STALE_MS = 5 * 60 * 1000;

/**
 * Roll an abandoned "publishing" run back to "completed" so it can be
 * published again. The conditional update (status + the exact claim time)
 * lets exactly one caller perform the rollback; only that caller resets the
 * assignments, so a later, legitimate publication is never undone.
 */
async function recoverStalePublication(run) {
  const reverted = await AllocationRun.findOneAndUpdate(
    { _id: run._id, status: "publishing", publishedAt: run.publishedAt },
    { $set: { status: "completed", selectedAlgorithm: null, publishedBy: null, publishedAt: null } },
    { new: true }
  ).lean();
  if (reverted && run.selectedAlgorithm) {
    await Allocation.updateMany(
      { run: new mongoose.Types.ObjectId(String(run._id)), algorithm: run.selectedAlgorithm },
      { $set: { status: "proposed" } }
    );
    logger.warn(
      { runId: String(run._id), algorithm: run.selectedAlgorithm },
      "Recovered a stale publication claim"
    );
  }
  return AllocationRun.findById(run._id).lean();
}

/**
 * Publish a completed allocation run.
 *
 * PUBLICATION-STATE POLICY
 *   completed --(atomic claim)--> publishing --(finalize)--> published
 *   * The admin must name the algorithm; only that algorithm's assignments
 *     become "published" (the other stays "proposed" for audit).
 *   * Before the claim, the ACTUAL stored assignments are re-validated
 *     (publicationValidation.service); cached metrics alone are not trusted.
 *   * The claim is one conditional findOneAndUpdate({status:"completed"}),
 *     which MongoDB applies atomically per document (also on a standalone
 *     server, no multi-document transaction needed). Exactly one concurrent
 *     request wins; losers get 409 and touch no assignments.
 *   * Repeating the SAME algorithm on a published run is idempotent (200, no
 *     writes). A DIFFERENT algorithm after publication is 409: changing the
 *     selection after publication is prohibited; create a new run instead.
 *   * If marking assignments or finalizing fails, the winner rolls back to
 *     "completed" / "proposed".
 *   RECOVERY: a process crash between claim and finalize leaves the run in
 *   "publishing". While the claim is younger than PUBLISH_STALE_MS publishes
 *   get 409; after that the next publish request rolls the stale claim back
 *   (one winner, conditional update) and proceeds normally.
 *   Assignments are immutable once a run completes (no endpoint edits them),
 *   so validate-then-claim cannot be invalidated by a concurrent writer.
 *
 * @param {string} runId
 * @param {string} publishedByUserId
 * @param {"baseline"|"optimized"} algorithm
 * @returns {Promise<object>} Updated AllocationRun document
 */
export async function publishAllocationRun(runId, publishedByUserId, algorithm) {
  if (!algorithm || !["baseline", "optimized"].includes(algorithm)) {
    throw ApiError.badRequest(
      "You must specify which algorithm to publish: 'baseline' or 'optimized'."
    );
  }

  let run = await AllocationRun.findById(runId).lean();
  if (!run) throw ApiError.notFound("Allocation run");

  if (
    run.status === "publishing" &&
    run.publishedAt &&
    Date.now() - new Date(run.publishedAt).getTime() > PUBLISH_STALE_MS
  ) {
    run = await recoverStalePublication(run);
    if (!run) throw ApiError.notFound("Allocation run");
  }

  // Returns the run when the request is an idempotent repeat; throws for a
  // conflict / non-publishable state; returns null when publishable.
  const checkState = (current) => {
    if (current.status === "published") {
      if (current.selectedAlgorithm === algorithm) return current;
      throw ApiError.conflict(
        `This run is already published using the "${current.selectedAlgorithm}" algorithm. ` +
          "Create a new run to publish the other algorithm's results."
      );
    }
    if (current.status === "publishing") {
      throw ApiError.conflict("This run is currently being published by another request.");
    }
    if (current.status !== "completed") {
      throw ApiError.badRequest(
        `Only completed runs can be published. Current status: "${current.status}".`
      );
    }
    return null;
  };

  const repeat = checkState(run);
  if (repeat) return repeat;

  const contained = run.algorithmsRun?.length ? run.algorithmsRun : ["baseline", "optimized"];
  if (!contained.includes(algorithm)) {
    throw ApiError.badRequest(
      `This run only contains the "${contained.join(", ")}" algorithm; it has no "${algorithm}" results to publish.`
    );
  }

  // Re-validate the real persisted assignments of the selected algorithm.
  const check = await validateRunForPublication(run, algorithm);
  await AllocationRun.updateOne(
    { _id: runId, status: "completed" },
    {
      $set: {
        publicationCheck: {
          algorithm,
          valid: check.valid,
          assignmentCount: check.assignmentCount,
          errorCount: check.errors.length,
          errorList: check.errors.slice(0, 20),
          checkedAt: new Date(),
        },
      },
    }
  );
  if (!check.valid) {
    throw new ApiError(
      422,
      `Cannot publish the "${algorithm}" results: ${check.errors.length} validation error(s).`,
      "PUBLICATION_VALIDATION_FAILED",
      check.errors.slice(0, 10)
    );
  }

  // Atomic claim: only one request can move completed -> publishing.
  const claimed = await AllocationRun.findOneAndUpdate(
    { _id: runId, status: "completed" },
    {
      $set: {
        status: "publishing",
        selectedAlgorithm: algorithm,
        publishedBy: new mongoose.Types.ObjectId(publishedByUserId),
        publishedAt: new Date(),
      },
    },
    { new: true }
  ).lean();

  if (!claimed) {
    // Lost the race (or the state changed): answer from the current state.
    const current = await AllocationRun.findById(runId).lean();
    if (!current) throw ApiError.notFound("Allocation run");
    const done = checkState(current);
    if (done) return done;
    throw ApiError.conflict("The run changed state during publication; retry.");
  }

  const runObjectId = new mongoose.Types.ObjectId(runId);
  try {
    const res = await Allocation.updateMany(
      { run: runObjectId, algorithm },
      { $set: { status: "published" } }
    );
    const matched = res?.matchedCount ?? res?.n;
    if (matched !== check.assignmentCount) {
      throw new Error(`Marked ${matched} of ${check.assignmentCount} assignments.`);
    }

    const finalized = await AllocationRun.findOneAndUpdate(
      { _id: runId, status: "publishing", selectedAlgorithm: algorithm },
      { $set: { status: "published" } },
      { new: true }
    ).lean();
    if (!finalized) throw new Error("Run was no longer in the publishing state.");

    await closePreferencesAfterPublish(finalized.semesterId);

    logger.info({ runId, algorithm, publishedBy: publishedByUserId }, "Allocation run published");
    return finalized;
  } catch (err) {
    logger.error({ runId, err: err.message }, "Failed to publish allocation run; rolling back");
    try {
      await Allocation.updateMany(
        { run: runObjectId, algorithm },
        { $set: { status: "proposed" } }
      );
      await AllocationRun.findOneAndUpdate(
        { _id: runId, status: "publishing", selectedAlgorithm: algorithm },
        { $set: { status: "completed", selectedAlgorithm: null, publishedBy: null, publishedAt: null } }
      );
    } catch (rollbackErr) {
      logger.error({ runId, err: rollbackErr.message }, "Publication rollback failed");
    }
    throw new ApiError(500, "Failed to publish the allocation run.", "PUBLISH_FAILED");
  }
}
