
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
    meritRatio = 0.7,
    randomRatio = 0.3,
    maxCoursesPerStudent = 2,
    oneCoursePerGroup = true,
    random = Math.random,
    timetable,
    fixedTimetable,
  } = options;

  const canEnroll =
    options.canEnroll ??
    (timetable
      ? createTimetableCanEnroll(timetable, fixedTimetable)
      : undefined);

  // Phase 1: Merit allocation
  const meritResult = allocateMeritPhase(
    { students, courses, preferences },
    {
      meritRatio,
      maxCoursesPerStudent,
      oneCoursePerGroup,
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
      oneCoursePerGroup,
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
    fixedTimetable: fixedTimetable ?? null,
    oneCoursePerGroup,
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
      meritResult.assumptions.oneCoursePerGroup
        ? "Merit allocation serves students in CGPA order; each takes the best available course of every group's own priority list."
        : "Merit allocation runs for two iterations.",
      "Merit and random quotas are calculated separately per course.",
      "Unused merit quota does not transfer to the random phase.",
      "Each student can receive at most the configured number of courses.",
      "Duplicate student-course allocations are prohibited.",
      meritResult.assumptions.oneCoursePerGroup
        ? "A student receives at most one course from each elective group."
        : "Elective groups are not enforced.",
      "Final allocations are validated before being returned.",
      timetable && fixedTimetable
        ? "Timetable validation is enabled, including each student's compulsory course slots."
        : timetable
        ? "Timetable validation is enabled."
        : "No timetable was supplied; timetable clash validation is not active.",
    ],
  };
}
