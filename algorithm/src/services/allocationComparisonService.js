
import { performance } from "node:perf_hooks";

import { runAllocation } from "../algorithms/allocationPipeline.js";
import { allocateOptimized } from "../algorithms/optimizedAllocation.js";
import { validateAllocation } from "../validation/validateAllocation.js";
import { compareAllocations } from "../evaluation/compare.js";
import { createSeededRandom, generateSeed } from "../utils/seededRandom.js";

/**
 * Bump when allocation behavior changes, so a stored run records which
 * version of the algorithms produced it.
 */
export const ALGORITHM_VERSION = "1.5.1";

const DEFAULT_MAX_COURSES_PER_STUDENT = 2;

function runAndMeasure(fn) {
  const start = performance.now();
  const result = fn();

  return {
    result,
    runtimeMs: Number((performance.now() - start).toFixed(3)),
  };
}

/**
 * Runs the baseline and MCMF algorithms on identical input data.
 *
 * Returns JSON-serializable allocation results, validation,
 * comparison metrics, and optimizer details.
 */
export function runAllocationComparison(input, options = {}) {
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

  const meritRatio = options.meritRatio ?? 0.7;
  const randomRatio = options.randomRatio ?? 0.3;
  const oneCoursePerGroup = options.oneCoursePerGroup ?? true;

  // The optimizer is held to the baseline's own result (no student ends worse)
  // and uses CGPA to decide who gets the better choices among equal results.
  const optimizerFloor = options.optimizerFloor ?? "baseline";
  const cgpaPriority = options.cgpaPriority ?? true;

  if (optimizerFloor !== "baseline" && optimizerFloor !== "none") {
    throw new Error('optimizerFloor must be "baseline" or "none".');
  }

  if (
    !Number.isInteger(maxCoursesPerStudent) ||
    maxCoursesPerStudent < 1
  ) {
    throw new Error("maxCoursesPerStudent must be a positive integer.");
  }

  if (
    !Number.isFinite(meritRatio) ||
    meritRatio < 0 ||
    meritRatio > 1
  ) {
    throw new Error("meritRatio must be between 0 and 1.");
  }

  if (
    !Number.isFinite(randomRatio) ||
    randomRatio < 0 ||
    randomRatio > 1
  ) {
    throw new Error("randomRatio must be between 0 and 1.");
  }

  // meritRatio is the share of each course's seats given by CGPA merit;
  // randomRatio is the share given by lottery. Together they must cover the
  // full capacity. 0/1 and 1/0 are both valid boundary configurations.
  if (Math.abs(meritRatio + randomRatio - 1) > 1e-9) {
    throw new Error("meritRatio and randomRatio must sum to 1.");
  }

  // Reproducible randomness: an explicit random function wins; otherwise a
  // seeded generator is used and the seed is reported back in the result.
  let randomSeed = null;
  let random = options.random;
  if (random === undefined) {
    randomSeed = options.seed ?? generateSeed();
    random = createSeededRandom(randomSeed);
  }

  const sharedOptions = {
    maxCoursesPerStudent,
    timetable,
    fixedTimetable,
    oneCoursePerGroup,
  };

  // Run the baseline: merit allocation followed by random allocation.
  const baselineRun = runAndMeasure(() =>
    runAllocation(
      { students, courses, preferences },
      {
        ...sharedOptions,
        meritRatio,
        randomRatio,
        random,
      }
    )
  );

  // Run the MCMF optimizer on the same input.
  const optimizedRun = runAndMeasure(() =>
    allocateOptimized(
      { students, courses, preferences },
      {
        ...sharedOptions,
        floor: optimizerFloor === "baseline" ? baselineRun.result.allocations : null,
        cgpaPriority,
        maxFlowSolves: options.maxFlowSolves,
        maxWork: options.maxWork,
        searchTimeLimitMs: options.searchTimeLimitMs,
      }
    )
  );

  // Explicitly validate both outputs.
  const baselineValidation = validateAllocation({
    students,
    courses,
    preferences,
    allocations: baselineRun.result.allocations,
    timetable: timetable ?? null,
    fixedTimetable: fixedTimetable ?? null,
    oneCoursePerGroup,
    maxCoursesPerStudent,
  });

  const optimizedValidation = validateAllocation({
    students,
    courses,
    preferences,
    allocations: optimizedRun.result.allocations,
    timetable: timetable ?? null,
    fixedTimetable: fixedTimetable ?? null,
    oneCoursePerGroup,
    maxCoursesPerStudent,
  });

  if (!baselineValidation.valid || !optimizedValidation.valid) {
    throw new Error(
      JSON.stringify(
        {
          message: "An allocation failed validation.",
          baselineErrors: baselineValidation.errors,
          optimizedErrors: optimizedValidation.errors,
        },
        null,
        2
      )
    );
  }

  const comparison = compareAllocations({
    input: {
      students,
      courses,
      preferences,
      timetable,
      fixedTimetable,
      oneCoursePerGroup,
      maxCoursesPerStudent,
    },
    baseline: baselineRun.result,
    optimized: optimizedRun.result,
    baselineRuntimeMs: baselineRun.runtimeMs,
    optimizedRuntimeMs: optimizedRun.runtimeMs,
  });

  return {
    success: true,

    configuration: {
      maxCoursesPerStudent,
      meritRatio,
      randomRatio,
      randomSeed,
      oneCoursePerGroup,
      optimizerFloor,
      cgpaPriority,
      algorithmVersion: ALGORITHM_VERSION,
      timetableValidationEnabled: Boolean(timetable),
      fixedTimetableEnabled: Boolean(timetable && fixedTimetable),
    },

    baseline: {
      allocations: baselineRun.result.allocations,
      metrics: comparison.baseline.metrics,
      runtimeMs: baselineRun.runtimeMs,
      validation: baselineValidation,
      phaseSummary: baselineRun.result.phaseSummary,
      assumptions: baselineRun.result.assumptions,
    },

    optimized: {
      allocations: optimizedRun.result.allocations,
      metrics: comparison.optimized.metrics,
      runtimeMs: optimizedRun.runtimeMs,
      validation: optimizedValidation,
      totalAllocated: optimizedRun.result.totalAllocated,
      totalPreferenceCost: optimizedRun.result.totalPreferenceCost,
      studentSummary: optimizedRun.result.studentSummary,
      courseSummary: optimizedRun.result.courseSummary,
      assumptions: optimizedRun.result.assumptions,
    },

    comparison: {
      improvement: comparison.improvement,
      validComparison: comparison.validComparison,
      note: comparison.note,
    },
  };
}
