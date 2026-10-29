
import { describe, it, expect } from "vitest";
import { allocateOptimized } from "../src/algorithms/optimizedAllocation.js";

describe("optimized allocation", () => {
  it("maximizes assignments when students compete for limited seats", () => {
    const students = [
      { id: "S1", cgpa: 9.5 },
      { id: "S2", cgpa: 8.5 },
      { id: "S3", cgpa: 7.5 },
    ];

    const courses = [
      { id: "C1", capacity: 1 },
      { id: "C2", capacity: 2 },
    ];

    const preferences = [
      { studentId: "S1", courseId: "C1", rank: 1 },
      { studentId: "S1", courseId: "C2", rank: 2 },
      { studentId: "S2", courseId: "C1", rank: 1 },
      { studentId: "S2", courseId: "C2", rank: 2 },
      { studentId: "S3", courseId: "C2", rank: 1 },
    ];

    const result = allocateOptimized(
      { students, courses, preferences },
      { maxCoursesPerStudent: 1 }
    );

    expect(result.totalAllocated).toBe(3);
    expect(result.allocations).toHaveLength(3);

    expect(
      result.allocations.filter((a) => a.courseId === "C1")
    ).toHaveLength(1);

    expect(
      result.allocations.filter((a) => a.courseId === "C2")
    ).toHaveLength(2);
  });

  it("does not assign overlapping courses to the same student", () => {
    const students = [{ id: "S1", cgpa: 9.0 }];

    const courses = [
      { id: "C1", capacity: 1 },
      { id: "C2", capacity: 1 },
    ];

    const preferences = [
      { studentId: "S1", courseId: "C1", rank: 1 },
      { studentId: "S1", courseId: "C2", rank: 2 },
    ];

    const timetable = {
      C1: [{ day: "Monday", start: "09:00", end: "09:50" }],
      C2: [{ day: "Monday", start: "09:30", end: "10:20" }],
    };

    const result = allocateOptimized(
      { students, courses, preferences },
      { maxCoursesPerStudent: 2, timetable }
    );

    expect(result.totalAllocated).toBe(1);
    expect(result.allocations).toHaveLength(1);
  });

  it("allows two courses when their timetable slots do not clash", () => {
    const students = [{ id: "S1", cgpa: 9.0 }];

    const courses = [
      { id: "C1", capacity: 1 },
      { id: "C2", capacity: 1 },
    ];

    const preferences = [
      { studentId: "S1", courseId: "C1", rank: 1 },
      { studentId: "S1", courseId: "C2", rank: 2 },
    ];

    const timetable = {
      C1: [{ day: "Monday", start: "09:00", end: "09:50" }],
      C2: [{ day: "Tuesday", start: "09:00", end: "09:50" }],
    };

    const result = allocateOptimized(
      { students, courses, preferences },
      { maxCoursesPerStudent: 2, timetable }
    );

    expect(result.totalAllocated).toBe(2);
    expect(result.allocations).toHaveLength(2);
  });

  it("never exceeds the maximum courses per student", () => {
    const students = [{ id: "S1", cgpa: 9.0 }];

    const courses = [
      { id: "C1", capacity: 1 },
      { id: "C2", capacity: 1 },
      { id: "C3", capacity: 1 },
    ];

    const preferences = [
      { studentId: "S1", courseId: "C1", rank: 1 },
      { studentId: "S1", courseId: "C2", rank: 2 },
      { studentId: "S1", courseId: "C3", rank: 3 },
    ];

    const result = allocateOptimized(
      { students, courses, preferences },
      { maxCoursesPerStudent: 2 }
    );

    expect(result.totalAllocated).toBe(2);
    expect(result.allocations).toHaveLength(2);
  });

  it("does not exceed course capacities", () => {
    const students = [
      { id: "S1", cgpa: 9.0 },
      { id: "S2", cgpa: 8.0 },
      { id: "S3", cgpa: 7.0 },
    ];

    const courses = [{ id: "C1", capacity: 1 }];

    const preferences = students.map((student, index) => ({
      studentId: student.id,
      courseId: "C1",
      rank: index + 1,
    }));

    const result = allocateOptimized(
      { students, courses, preferences },
      { maxCoursesPerStudent: 2 }
    );

    expect(result.totalAllocated).toBe(1);
    expect(
      result.allocations.filter((a) => a.courseId === "C1")
    ).toHaveLength(1);
  });
});
