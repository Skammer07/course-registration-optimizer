
import { describe, it, expect } from "vitest";
import { allocateMeritPhase } from "../src/algorithms/baseline.js";

describe("Merit allocation", () => {
  it("allocates to higher-CGPA students first", () => {
    const input = {
      students: [
        { id: "S1", cgpa: 7 },
        { id: "S2", cgpa: 9 },
      ],
      courses: [{ id: "C1", capacity: 4 }],
      preferences: [
        { studentId: "S1", courseId: "C1", rank: 1 },
        { studentId: "S2", courseId: "C1", rank: 1 },
      ],
    };

    const result = allocateMeritPhase(input);

    expect(result.allocations[0].studentId).toBe("S2");
  });

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

    expect(result.courseSummary[0].meritQuota).toBe(3);
    expect(result.courseSummary[0].meritAllocated).toBe(4);
    expect(result.allocations.map(a => a.studentId)).toContain("S4");
  });

  it("checks a student's next preference if the first course is full", () => {
    const input = {
      students: [
        { id: "S1", cgpa: 9 },
        { id: "S2", cgpa: 8 },
      ],
      courses: [
        { id: "C1", capacity: 1 },
        { id: "C2", capacity: 4 },
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
    });
  });

  it("does not allocate a course with zero merit quota", () => {
    const input = {
      students: [{ id: "S1", cgpa: 9 }],
      courses: [{ id: "C1", capacity: 1 }],
      preferences: [{ studentId: "S1", courseId: "C1", rank: 1 }],
    };

    const result = allocateMeritPhase(input);

    expect(result.courseSummary[0].meritQuota).toBe(0);
    expect(result.courseSummary[0].meritAllocated).toBe(0);
    expect(result.unallocatedStudentIds).toContain("S1");
  });

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

  it("does not exceed the total course capacity", () => {
    const input = {
      students: [
        { id: "S1", cgpa: 9 },
        { id: "S2", cgpa: 8 },
        { id: "S3", cgpa: 7 },
        { id: "S4", cgpa: 6 },
      ],
      courses: [{ id: "C1", capacity: 2 }],
      preferences: [
        { studentId: "S1", courseId: "C1", rank: 1 },
        { studentId: "S2", courseId: "C1", rank: 1 },
        { studentId: "S3", courseId: "C1", rank: 1 },
        { studentId: "S4", courseId: "C1", rank: 1 },
      ],
    };

    const result = allocateMeritPhase(input);

    expect(result.courseSummary[0].meritQuota).toBe(1);
    expect(result.courseSummary[0].meritAllocated).toBeLessThanOrEqual(2);
    expect(result.allocations).toHaveLength(1);
  });

  it("rejects invalid course capacity", () => {
    const input = {
      students: [{ id: "S1", cgpa: 9 }],
      courses: [{ id: "C1", capacity: -1 }],
      preferences: [],
    };

    expect(() => allocateMeritPhase(input)).toThrow(
      "Invalid capacity for course C1"
    );
  });
});
