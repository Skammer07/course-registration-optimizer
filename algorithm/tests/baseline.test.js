
import { describe, it, expect } from "vitest";
import { allocateMeritPhase } from "../src/algorithms/baseline.js";

describe("Merit allocation", () => {

  // TEST 1: Higher CGPA gets priority
  it("allocates to higher-CGPA students first", () => {
    const input = {
      students: [
        { id: "S1", cgpa: 8 },
        { id: "S2", cgpa: 9 },
      ],
      courses: [{ id: "C1", capacity: 2 }],
      preferences: [
        { studentId: "S1", courseId: "C1", rank: 1 },
        { studentId: "S2", courseId: "C1", rank: 1 },
      ],
    };

    const result = allocateMeritPhase(input);

    expect(result.allocations[0].studentId).toBe("S2");
  });

  // TEST 2: CGPA ties can exceed merit quota
  it("allows a CGPA tie group to cross the merit quota", () => {
    const input = {
      students: [
        { id: "S1", cgpa: 9 },
        { id: "S2", cgpa: 8 },
        { id: "S3", cgpa: 7 },
        { id: "S4", cgpa: 7 },
        { id: "S5", cgpa: 6 },
      ],
      courses: [{ id: "C1", capacity: 4 }],
      preferences: [
        { studentId: "S1", courseId: "C1", rank: 1 },
        { studentId: "S2", courseId: "C1", rank: 1 },
        { studentId: "S3", courseId: "C1", rank: 1 },
        { studentId: "S4", courseId: "C1", rank: 1 },
        { studentId: "S5", courseId: "C1", rank: 1 },
      ],
    };

    const result = allocateMeritPhase(input);

    expect(result.allocations).toHaveLength(4);
    expect(
      result.allocations.filter(a => a.courseId === "C1")
    ).toHaveLength(4);
  });

  // TEST 3: Try next preference when first is unavailable
  it("checks a student's next preference if the first course is full", () => {
    const input = {
      students: [
        { id: "S1", cgpa: 9 },
        { id: "S2", cgpa: 8 },
      ],
      courses: [
        { id: "C1", capacity: 1 },
        { id: "C2", capacity: 2 },
      ],
      preferences: [
        { studentId: "S1", courseId: "C1", rank: 1 },
        { studentId: "S2", courseId: "C1", rank: 1 },
        { studentId: "S2", courseId: "C2", rank: 2 },
      ],
    };

    const result = allocateMeritPhase(input);

    expect(result.allocations).toContainEqual({
      studentId: "S2",
      courseId: "C2",
      preferenceRank: 2,
      phase: "merit",
      iteration: 1,
    });
  });

  // TEST 4: Zero merit quota means no merit allocation
  it("does not allocate a course with zero merit quota", () => {
    const input = {
      students: [{ id: "S1", cgpa: 9 }],
      courses: [{ id: "C1", capacity: 1 }],
      preferences: [
        { studentId: "S1", courseId: "C1", rank: 1 },
      ],
    };

    const result = allocateMeritPhase(input, { meritRatio: 0 });

    expect(result.allocations).toHaveLength(0);
  });

  // TEST 5: Students without preferences remain unallocated
  it("handles a student with no preferences", () => {
    const input = {
      students: [{ id: "S1", cgpa: 9 }],
      courses: [{ id: "C1", capacity: 4 }],
      preferences: [],
    };

    const result = allocateMeritPhase(input);

    expect(result.allocations).toHaveLength(0);
    expect(result.unallocatedStudentIds).toContain("S1");
  });

  // TEST 6: Never exceed physical course capacity
  it("does not exceed the total course capacity", () => {
    const input = {
      students: [
        { id: "S1", cgpa: 9 },
        { id: "S2", cgpa: 8 },
        { id: "S3", cgpa: 7 },
      ],
      courses: [{ id: "C1", capacity: 2 }],
      preferences: [
        { studentId: "S1", courseId: "C1", rank: 1 },
        { studentId: "S2", courseId: "C1", rank: 1 },
        { studentId: "S3", courseId: "C1", rank: 1 },
      ],
    };

    const result = allocateMeritPhase(input);

    expect(result.allocations.length).toBeLessThanOrEqual(2);
  });

  // TEST 7: Reject invalid capacity
  it("rejects invalid course capacity", () => {
    const input = {
      students: [{ id: "S1", cgpa: 9 }],
      courses: [{ id: "C1", capacity: -1 }],
      preferences: [],
    };

    expect(() => allocateMeritPhase(input)).toThrow(
      /Invalid capacity/
    );
  });

  // TEST 8: A student can get a second course in merit iteration 2
  it("allocates a second course during merit iteration 2", () => {
    const input = {
      students: [
        { id: "S1", cgpa: 9 },
        { id: "S2", cgpa: 8 },
      ],
      courses: [
        { id: "C1", capacity: 4 },
        { id: "C2", capacity: 4 },
      ],
      preferences: [
        { studentId: "S1", courseId: "C1", rank: 1 },
        { studentId: "S1", courseId: "C2", rank: 2 },
        { studentId: "S2", courseId: "C1", rank: 1 },
        { studentId: "S2", courseId: "C2", rank: 2 },
      ],
    };

    const result = allocateMeritPhase(input);

    const s1Allocations = result.allocations.filter(
      a => a.studentId === "S1"
    );

    expect(s1Allocations).toHaveLength(2);

    expect(
      s1Allocations.some(a => a.iteration === 1)
    ).toBe(true);

    expect(
      s1Allocations.some(a => a.iteration === 2)
    ).toBe(true);

    expect(new Set(s1Allocations.map(a => a.courseId)).size)
      .toBe(2);
  });

  // TEST 9: No duplicate course for the same student
  it("does not allocate the same course to a student twice", () => {
    const input = {
      students: [{ id: "S1", cgpa: 9 }],
      courses: [{ id: "C1", capacity: 4 }],
      preferences: [
        { studentId: "S1", courseId: "C1", rank: 1 },
      ],
    };

    const result = allocateMeritPhase(input);

    const studentCourses = result.allocations
      .filter(a => a.studentId === "S1")
      .map(a => a.courseId);

    expect(studentCourses).toEqual(["C1"]);

    expect(new Set(studentCourses).size)
      .toBe(studentCourses.length);
  });

  // TEST 10: Merit quota is shared across both iterations
  it("shares the merit quota across both iterations", () => {
    const input = {
      students: [
        { id: "S1", cgpa: 9 },
        { id: "S2", cgpa: 8 },
        { id: "S3", cgpa: 7 },
      ],
      courses: [
        { id: "C1", capacity: 4 },
        { id: "C2", capacity: 4 },
      ],
      preferences: [
        { studentId: "S1", courseId: "C1", rank: 1 },
        { studentId: "S1", courseId: "C2", rank: 2 },
        { studentId: "S2", courseId: "C1", rank: 1 },
        { studentId: "S2", courseId: "C2", rank: 2 },
        { studentId: "S3", courseId: "C1", rank: 1 },
        { studentId: "S3", courseId: "C2", rank: 2 },
      ],
    };

    const result = allocateMeritPhase(input);

    for (const course of result.courseSummary) {
      expect(course.meritQuota).toBe(3);
      expect(course.meritAllocated).toBeLessThanOrEqual(3);
    }

    expect(
      result.allocations.some(a => a.iteration === 2)
    ).toBe(true);
  });

});
