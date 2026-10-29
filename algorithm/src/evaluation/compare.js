import { calculateMetrics } from "./metrics.js";

/**
 * Compare baseline and optimized allocation results on identical input data.
 *
 * Example:
 * compareAllocations({
 *   input: { students, courses, preferences, timetable },
 *   baseline: { allocations: [...] },
 *   optimized: { allocations: [...] },
 *   baselineRuntimeMs: 5,
 *   optimizedRuntimeMs: 8
 * });
 */
export function compareAllocations({
  input,
  baseline,
  optimized,
  baselineRuntimeMs = null,
  optimizedRuntimeMs = null,
} = {}) {
  if (!input) {
    throw new Error("input is required for comparison");
  }

  if (!baseline || !Array.isArray(baseline.allocations)) {
    throw new Error("baseline.allocations must be an array");
  }

  if (!optimized || !Array.isArray(optimized.allocations)) {
    throw new Error("optimized.allocations must be an array");
  }

  const sharedInput = {
    students: input.students ?? [],
    courses: input.courses ?? [],
    preferences: input.preferences ?? [],
    timetable: input.timetable,
    maxCoursesPerStudent: input.maxCoursesPerStudent ?? 2,
  };

  const baselineMetrics = calculateMetrics({
    ...sharedInput,
    allocations: baseline.allocations,
  });

  const optimizedMetrics = calculateMetrics({
    ...sharedInput,
    allocations: optimized.allocations,
  });

  const delta = (key) =>
    Number(
      (optimizedMetrics[key] - baselineMetrics[key]).toFixed(2)
    );

  return {
    baseline: {
      metrics: baselineMetrics,
      runtimeMs: baselineRuntimeMs,
    },

    optimized: {
      metrics: optimizedMetrics,
      runtimeMs: optimizedRuntimeMs,
    },

    improvement: {
      totalAssignments: delta("totalAssignments"),
      studentsWithTwoCourses: delta("studentsWithTwoCourses"),
      studentsWithAtLeastOneCourse: delta(
        "studentsWithAtLeastOneCourse"
      ),
      unallocatedStudents: delta("unallocatedStudents"),
      rank1Assignments: delta("rank1Assignments"),
      averagePreferenceRank: 
        baselineMetrics.averagePreferenceRank === null ||
        optimizedMetrics.averagePreferenceRank === null
          ? null
          : Number(
              (
                baselineMetrics.averagePreferenceRank -
                optimizedMetrics.averagePreferenceRank
              ).toFixed(2)
            ),
      constraintViolations: delta("constraintViolations"),
      runtimeMs:
        baselineRuntimeMs === null || optimizedRuntimeMs === null
          ? null
          : Number((optimizedRuntimeMs - baselineRuntimeMs).toFixed(3)),
    },

    validComparison:
      baselineMetrics.constraintViolations === 0 &&
      optimizedMetrics.constraintViolations === 0,

    note:
      "A positive average-preference-rank improvement means the optimized algorithm assigns better-ranked preferences. A negative constraint-violation delta means fewer violations.",
  };
}