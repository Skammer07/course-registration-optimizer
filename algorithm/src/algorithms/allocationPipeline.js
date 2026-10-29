
import { allocateMeritPhase } from "./baseline.js";
import { allocateRandomPhase } from "./randomAllocation.js";
import { createTimetableCanEnroll } from "../timetable/checkClash.js";
import { validateAllocation } from "../validation/validateAllocation.js";

export function runAllocation(input, options = {}) {
  const { students, courses, preferences } = input;

  if (
    !Array.isArray(students) ||
    !Array.isArray(courses) ||
    !Array.isArray(preferences)
  ) {
    throw new Error(
      "Input must contain students, courses, and preferences arrays"
    );
  }

  const {
    meritRatio = 0.75,
    randomRatio = 0.25,
    maxCoursesPerStudent = 2,
    random = Math.random,
    timetable,
  } = options;

  const canEnroll =
    options.canEnroll ??
    (timetable ? createTimetableCanEnroll(timetable) : undefined);

  // Phase 1: Merit allocation
  const meritResult = allocateMeritPhase(
    { students, courses, preferences },
    {
      meritRatio,
      maxCoursesPerStudent,
      canEnroll,
    }
  );

  // Phase 2: Random allocation
  const randomResult = allocateRandomPhase(
    {
      students,
      courses,
      preferences,
      existingAllocations: meritResult.allocations,
    },
    {
      randomRatio,
      maxCoursesPerStudent,
      random,
      canEnroll,
    }
  );

  const allocations = [
    ...meritResult.allocations,
    ...randomResult.allocations,
  ];

  // Validate the final combined allocation.
  const validation = validateAllocation({
    students,
    courses,
    preferences,
    allocations,
    timetable: timetable ?? null,
    maxCoursesPerStudent,
  });

  if (!validation.valid) {
    throw new Error(
      `Allocation validation failed:\n- ${validation.errors.join("\n- ")}`
    );
  }

  return {
    allocations,
    meritResult,
    randomResult,
    validation,

    // Preserve the existing structure expected by tests.
    phaseSummary: {
      merit: {
        allocated: meritResult.allocations.length,
      },
      random: {
        allocated: randomResult.allocations.length,
      },
    },

    assumptions: [
      "Merit allocation runs for two iterations.",
      "Merit and random quotas are calculated separately per course.",
      "Unused merit quota does not transfer to the random phase.",
      "Each student can receive at most the configured number of courses.",
      "Duplicate student-course allocations are prohibited.",
      "Final allocations are validated before being returned.",
      timetable
        ? "Timetable validation is enabled."
        : "No timetable was supplied; timetable clash validation is not active.",
    ],
  };
}
