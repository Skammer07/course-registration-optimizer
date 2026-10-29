
import { describe, it, expect } from "vitest";
import { runAllocation } from "../src/algorithms/allocationPipeline.js";
import { hasTimetableClash } from "../src/timetable/checkClash.js";

describe("Timetable integration with complete allocation pipeline", () => {
  const students = [
    { id: "S1", cgpa: 9.5 },
    { id: "S2", cgpa: 9.0 },
    { id: "S3", cgpa: 8.5 },
    { id: "S4", cgpa: 8.0 },
    { id: "S5", cgpa: 7.5 },
    { id: "S6", cgpa: 7.0 },
  ];

  const courses = [
    { id: "C1", capacity: 4 },
    { id: "C2", capacity: 4 },
    { id: "C3", capacity: 4 },
  ];

  const preferences = [
    { studentId: "S1", courseId: "C1", rank: 1 },
    { studentId: "S1", courseId: "C2", rank: 2 },

    { studentId: "S2", courseId: "C1", rank: 1 },
    { studentId: "S2", courseId: "C2", rank: 2 },

    { studentId: "S3", courseId: "C2", rank: 1 },
    { studentId: "S3", courseId: "C3", rank: 2 },

    { studentId: "S4", courseId: "C1", rank: 1 },
    { studentId: "S4", courseId: "C3", rank: 2 },

    { studentId: "S5", courseId: "C3", rank: 1 },
    { studentId: "S5", courseId: "C2", rank: 2 },

    { studentId: "S6", courseId: "C2", rank: 1 },
    { studentId: "S6", courseId: "C3", rank: 2 },
  ];

  const timetable = {
    C1: [
      { day: "Monday", start: "09:00", end: "09:50" },
      { day: "Wednesday", start: "09:00", end: "09:50" },
    ],
    C2: [
      { day: "Monday", start: "09:00", end: "09:50" },
      { day: "Thursday", start: "10:00", end: "10:50" },
    ],
    C3: [
      { day: "Tuesday", start: "11:00", end: "11:50" },
      { day: "Friday", start: "11:00", end: "11:50" },
    ],
  };

  const input = { students, courses, preferences };

  it("never assigns a student two courses with overlapping timetables", () => {
    const result = runAllocation(input, {
      meritRatio: 0.75,
      randomRatio: 0.25,
      maxCoursesPerStudent: 2,
      random: () => 0.5,
      timetable,
    });

    for (const student of students) {
      const studentAllocations = result.allocations.filter(
        allocation => allocation.studentId === student.id
      );

      for (let i = 0; i < studentAllocations.length; i++) {
        for (let j = i + 1; j < studentAllocations.length; j++) {
          const first = studentAllocations[i];
          const second = studentAllocations[j];

          expect(
            hasTimetableClash(
              second.courseId,
              [first],
              timetable
            ),
            `${student.id} has a clash between ${first.courseId} and ${second.courseId}`
          ).toBe(false);
        }
      }
    }
  });

  it("never assigns more than two courses to a student", () => {
    const result = runAllocation(input, {
      timetable,
      random: () => 0.5,
    });

    for (const student of students) {
      const count = result.allocations.filter(
        allocation => allocation.studentId === student.id
      ).length;

      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it("never exceeds physical course capacity", () => {
    const result = runAllocation(input, {
      timetable,
      random: () => 0.5,
    });

    for (const course of courses) {
      const count = result.allocations.filter(
        allocation => allocation.courseId === course.id
      ).length;

      expect(count).toBeLessThanOrEqual(course.capacity);
    }
  });

  it("never assigns the same course to the same student twice", () => {
    const result = runAllocation(input, {
      timetable,
      random: () => 0.5,
    });

    const pairs = result.allocations.map(
      allocation => `${allocation.studentId}::${allocation.courseId}`
    );

    expect(new Set(pairs).size).toBe(pairs.length);
  });
});
