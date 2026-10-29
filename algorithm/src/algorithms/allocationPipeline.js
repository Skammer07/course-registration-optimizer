
import { allocateMeritPhase } from "./baseline.js";
import { allocateRandomPhase } from "./randomAllocation.js";
import { createTimetableCanEnroll } from "../timetable/checkClash.js";

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

  // Phase 2: Random allocation.
  // Existing merit allocations belong in the FIRST argument.
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

  return {
    allocations,
    meritResult,
    randomResult,

    // Preserve the structure expected by the existing tests.
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
      timetable
        ? "Timetable validation is enabled."
        : "No timetable was supplied; timetable clash validation is not active.",
    ],
  };
}
