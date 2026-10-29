
import { describe, it, expect } from "vitest";

import { runAllocation } from "../src/algorithms/allocationPipeline.js";
import { allocateOptimized } from "../src/algorithms/optimizedAllocation.js";
import { validateAllocation } from "../src/validation/validateAllocation.js";

function createScenario({
  studentCount,
  capacities,
  preferenceLists,
  clashC1C2 = false,
}) {
  const students = Array.from({ length: studentCount }, (_, i) => ({
    id: `S${i + 1}`,
    cgpa: 9.5 - i * 0.5,
  }));

  const courses = capacities.map((capacity, i) => ({
    id: `C${i + 1}`,
    name: `Course ${i + 1}`,
    capacity,
  }));

  const preferences = [];

  for (const [studentIndex, courseIds] of Object.entries(preferenceLists)) {
    courseIds.forEach((courseId, index) => {
      preferences.push({
        studentId: `S${Number(studentIndex) + 1}`,
        courseId,
        rank: index + 1,
      });
    });
  }

  // Every course gets a valid timetable slot.
  const timetable = {};

  courses.forEach((course, index) => {
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

    timetable[course.id] = [
      {
        day: days[index % days.length],
        start: "09:00",
        end: "10:00",
      },
    ];
  });

  // C1 and C2 intentionally overlap in the clash scenario.
  if (clashC1C2 && timetable.C1 && timetable.C2) {
    timetable.C1 = [
      { day: "Monday", start: "09:00", end: "10:00" },
    ];

    timetable.C2 = [
      { day: "Monday", start: "09:30", end: "10:30" },
    ];
  }

  return { students, courses, preferences, timetable };
}

const scenarios = [
  {
    name: "limited seats",
    input: createScenario({
      studentCount: 8,
      capacities: [4, 4, 4],
      preferenceLists: {
        0: ["C1", "C2"],
        1: ["C1", "C2"],
        2: ["C1", "C2"],
        3: ["C1", "C2"],
        4: ["C2", "C3"],
        5: ["C2", "C3"],
        6: ["C3", "C1"],
        7: ["C3", "C2"],
      },
    }),
  },
  {
    name: "more students than available seats",
    input: createScenario({
      studentCount: 8,
      capacities: [4, 4],
      preferenceLists: {
        0: ["C1", "C2"],
        1: ["C1", "C2"],
        2: ["C1", "C2"],
        3: ["C1", "C2"],
        4: ["C1", "C2"],
        5: ["C1", "C2"],
        6: ["C1", "C2"],
        7: ["C1", "C2"],
      },
    }),
  },
  {
    name: "overlapping timetable slots",
    input: createScenario({
      studentCount: 6,
      capacities: [4, 4, 4],
      preferenceLists: {
        0: ["C1", "C2", "C3"],
        1: ["C1", "C2", "C3"],
        2: ["C2", "C1", "C3"],
        3: ["C1", "C3"],
        4: ["C2", "C3"],
        5: ["C3", "C1"],
      },
      clashC1C2: true,
    }),
  },
  {
    name: "one course has no demand",
    input: createScenario({
      studentCount: 4,
      capacities: [4, 4, 4],
      preferenceLists: {
        0: ["C1"],
        1: ["C1"],
        2: ["C2"],
        3: ["C2"],
      },
    }),
  },
  {
    name: "some students have no preferences",
    input: createScenario({
      studentCount: 6,
      capacities: [4, 4, 4],
      preferenceLists: {
        0: ["C1", "C2"],
        1: ["C2", "C3"],
        2: ["C1", "C3"],
      },
    }),
  },
  {
    name: "students tied on CGPA",
    input: (() => {
      const input = createScenario({
        studentCount: 6,
        capacities: [4, 4, 4],
        preferenceLists: {
          0: ["C1", "C2"],
          1: ["C1", "C2"],
          2: ["C1", "C3"],
          3: ["C2", "C3"],
          4: ["C3", "C1"],
          5: ["C2", "C1"],
        },
      });

      input.students[0].cgpa = 8.5;
      input.students[1].cgpa = 8.5;

      return input;
    })(),
  },
];

describe.each(scenarios)("$name", ({ input }) => {
  it("produces valid baseline allocations", () => {
    const result = runAllocation(
      {
        students: input.students,
        courses: input.courses,
        preferences: input.preferences,
      },
      {
        timetable: input.timetable,
        maxCoursesPerStudent: 2,
        random: () => 0.5,
      }
    );

    const validation = validateAllocation({
      ...input,
      allocations: result.allocations,
      maxCoursesPerStudent: 2,
    });

    expect(validation.valid, validation.errors.join("\n")).toBe(true);
  });

  it("produces valid optimized allocations", () => {
    const result = allocateOptimized(
      {
        students: input.students,
        courses: input.courses,
        preferences: input.preferences,
      },
      {
        timetable: input.timetable,
        maxCoursesPerStudent: 2,
      }
    );

    const validation = validateAllocation({
      ...input,
      allocations: result.allocations,
      maxCoursesPerStudent: 2,
    });

    expect(validation.valid, validation.errors.join("\n")).toBe(true);
  });
});
