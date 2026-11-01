import { performance } from "node:perf_hooks";

import { runAllocation } from "../algorithms/allocationPipeline.js";
import { allocateOptimized } from "../algorithms/optimizedAllocation.js";
import { validateAllocation } from "../validation/validateAllocation.js";
import { calculateMetrics } from "../evaluation/metrics.js";
import { createSeededRandom, generateSeed } from "../utils/seededRandom.js";
import { ALGORITHM_VERSION } from "./allocationComparisonService.js";

const DEFAULT_MAX_COURSES_PER_STUDENT = 2;

function runAndMeasure(fn) {
  const start = performance.now();
  const result = fn();
  return { result, runtimeMs: Number((performance.now() - start).toFixed(3)) };
}

/**
 * Runs ONE selected algorithm ("baseline" or "optimized") on the input and
 * returns its allocations, metrics, runtime and validation in the same shape
 * as one side of runAllocationComparison. Used when the two algorithms are
 * run independently and compared afterwards.
 *
 * Options: maxCoursesPerStudent; for "baseline" only: meritRatio, randomRatio
 * (must sum to 1), seed / random. The optimizer ignores ratios and seed.
 */
export function runSingleAllocation(input, options = {}) {
  const { algorithm } = options;

  if (algorithm !== "baseline" && algorithm !== "optimized") {
    throw new Error('algorithm must be "baseline" or "optimized".');
  }

  if (!input || typeof input !== "object") {
    throw new Error("Input is required.");
  }

  const { students, courses, preferences, timetable, fixedTimetable } = input;

  if (
    !Array.isArray(students) ||
    !Array.isArray(courses) ||
    !Array.isArray(preferences)
  ) {
    throw new Error(
      "Input must contain students, courses, and preferences arrays."
    );
  }

  const maxCoursesPerStudent =
    options.maxCoursesPerStudent ?? DEFAULT_MAX_COURSES_PER_STUDENT;

  if (!Number.isInteger(maxCoursesPerStudent) || maxCoursesPerStudent < 1) {
    throw new Error("maxCoursesPerStudent must be a positive integer.");
  }

  const oneCoursePerGroup = options.oneCoursePerGroup ?? true;

  // The optimizer is held to the baseline: no student may end worse than the
  // baseline's own result (computed here with the same split and seed), and it
  // uses CGPA to decide who gets the better choices among equal results.
  const optimizerFloor = options.optimizerFloor ?? "baseline";
  const cgpaPriority = options.cgpaPriority ?? true;

  if (optimizerFloor !== "baseline" && optimizerFloor !== "none") {
    throw new Error('optimizerFloor must be "baseline" or "none".');
  }

  const configuration = {
    algorithm,
    maxCoursesPerStudent,
    oneCoursePerGroup,
    optimizerFloor: algorithm === "optimized" ? optimizerFloor : null,
    cgpaPriority: algorithm === "optimized" ? cgpaPriority : null,
    meritRatio: null,
    randomRatio: null,
    randomSeed: null,
    algorithmVersion: ALGORITHM_VERSION,
    timetableValidationEnabled: Boolean(timetable),
    fixedTimetableEnabled: Boolean(timetable && fixedTimetable),
  };

  let run;

  // The baseline is run for "baseline" itself and, as the floor, for "optimized".
  let baselineRun = null;

  if (algorithm === "baseline" || optimizerFloor === "baseline") {
    const meritRatio = options.meritRatio ?? 0.7;
    const randomRatio = options.randomRatio ?? 0.3;

    if (!Number.isFinite(meritRatio) || meritRatio < 0 || meritRatio > 1) {
      throw new Error("meritRatio must be between 0 and 1.");
    }
    if (!Number.isFinite(randomRatio) || randomRatio < 0 || randomRatio > 1) {
      throw new Error("randomRatio must be between 0 and 1.");
    }
    if (Math.abs(meritRatio + randomRatio - 1) > 1e-9) {
      throw new Error("meritRatio and randomRatio must sum to 1.");
    }

    let random = options.random;
    if (random === undefined) {
      configuration.randomSeed = options.seed ?? generateSeed();
      random = createSeededRandom(configuration.randomSeed);
    }
    configuration.meritRatio = meritRatio;
    configuration.randomRatio = randomRatio;

    baselineRun = runAndMeasure(() =>
      runAllocation(
        { students, courses, preferences },
        { maxCoursesPerStudent, timetable, fixedTimetable, oneCoursePerGroup, meritRatio, randomRatio, random }
      )
    );
  }

  if (algorithm === "baseline") {
    run = baselineRun;
  } else {
    run = runAndMeasure(() =>
      allocateOptimized(
        { students, courses, preferences },
        {
          maxCoursesPerStudent,
          timetable,
          fixedTimetable,
          oneCoursePerGroup,
          floor: optimizerFloor === "baseline" ? baselineRun.result.allocations : null,
          cgpaPriority,
          maxFlowSolves: options.maxFlowSolves,
          maxWork: options.maxWork,
          searchTimeLimitMs: options.searchTimeLimitMs,
        }
      )
    );
  }

  const validation = validateAllocation({
    students,
    courses,
    preferences,
    allocations: run.result.allocations,
    timetable: timetable ?? null,
    fixedTimetable: fixedTimetable ?? null,
    oneCoursePerGroup,
    maxCoursesPerStudent,
  });

  if (!validation.valid) {
    throw new Error(
      JSON.stringify(
        { message: "The allocation failed validation.", errors: validation.errors },
        null,
        2
      )
    );
  }

  const metrics = calculateMetrics({
    students,
    courses,
    preferences,
    timetable,
    fixedTimetable,
    oneCoursePerGroup,
    maxCoursesPerStudent,
    allocations: run.result.allocations,
  });

  return {
    success: true,
    algorithm,
    configuration,
    allocations: run.result.allocations,
    metrics,
    runtimeMs: run.runtimeMs,
    validation,
    // Policy details so a caller can state what the algorithm did and did not
    // enforce (baseline: phase split + assumptions; optimizer: objective and
    // meritRandomQuotasPreserved=false).
    phaseSummary: algorithm === "baseline" ? run.result.phaseSummary : null,
    assumptions: run.result.assumptions,
    totalPreferenceCost:
      algorithm === "optimized" ? run.result.totalPreferenceCost : null,
  };
}
