
import { describe, it, expect } from "vitest";
import { allocateRandomPhase } from "../src/algorithms/randomAllocation.js";

describe("Random allocation", () => {
  it("respects the separate 25% random quota", () => {
    const result = allocateRandomPhase({
      students: [
        { id: "S1", cgpa: 9 },
        { id: "S2", cgpa: 8 },
        { id: "S3", cgpa: 7 },
        { id: "S4", cgpa: 6 },
      ],
      courses: [{ id: "C1", capacity: 8 }],
      preferences: [
        { studentId: "S1", courseId: "C1", rank: 1 },
        { studentId: "S2", courseId: "C1", rank: 1 },
        { studentId: "S3", courseId: "C1", rank: 1 },
        { studentId: "S4", courseId: "C1", rank: 1 },
      ],
      existingAllocations: [],
    }, {
      random: () => 0.5,
    });

    expect(result.courseSummary[0].randomQuota).toBe(2);
    expect(result.courseSummary[0].randomAllocated).toBe(2);
    expect(result.allocations).toHaveLength(2);
  });

  it("counts merit allocations toward the two-course limit", () => {
    const result = allocateRandomPhase({
      students: [
        { id: "S1", cgpa: 9 },
        { id: "S2", cgpa: 8 },
      ],
      courses: [
        { id: "C1", capacity: 4 },
        { id: "C2", capacity: 4 },
      ],
      preferences: [
        { studentId: "S1", courseId: "C2", rank: 1 },
        { studentId: "S2", courseId: "C2", rank: 1 },
      ],
      existingAllocations: [
        { studentId: "S1", courseId: "C1", phase: "merit" },
        { studentId: "S1", courseId: "C3", phase: "merit" },
      ].filter(a => a.courseId !== "C3"),
    }, {
      random: () => 0.5,
    });

    expect(
      result.allocations.some(a => a.studentId === "S1")
    ).toBe(true);

    expect(
      result.studentSummary.find(s => s.studentId === "S1")
        .coursesAllocated
    ).toBe(2);
  });

  it("skips students who already have two courses", () => {
    const result = allocateRandomPhase({
      students: [
        { id: "S1", cgpa: 9 },
        { id: "S2", cgpa: 8 },
      ],
      courses: [
        { id: "C1", capacity: 4 },
        { id: "C2", capacity: 4 },
        { id: "C3", capacity: 4 },
      ],
      preferences: [
        { studentId: "S1", courseId: "C3", rank: 1 },
        { studentId: "S2", courseId: "C3", rank: 1 },
      ],
      existingAllocations: [
        { studentId: "S1", courseId: "C1", phase: "merit" },
        { studentId: "S1", courseId: "C2", phase: "merit" },
      ],
    }, {
      random: () => 0.5,
    });

    expect(
      result.allocations.some(a => a.studentId === "S1")
    ).toBe(false);

    expect(
      result.allocations.some(a => a.studentId === "S2")
    ).toBe(true);
  });

  it("does not allocate the same course twice to a student", () => {
    const result = allocateRandomPhase({
      students: [{ id: "S1", cgpa: 9 }],
      courses: [{ id: "C1", capacity: 4 }],
      preferences: [
        { studentId: "S1", courseId: "C1", rank: 1 },
      ],
      existingAllocations: [
        { studentId: "S1", courseId: "C1", phase: "merit" },
      ],
    });

    expect(result.allocations).toHaveLength(0);
  });

  it("never exceeds total course capacity", () => {
    const result = allocateRandomPhase({
      students: [
        { id: "S1", cgpa: 9 },
        { id: "S2", cgpa: 8 },
        { id: "S3", cgpa: 7 },
      ],
      courses: [{ id: "C1", capacity: 4 }],
      preferences: [
        { studentId: "S1", courseId: "C1", rank: 1 },
        { studentId: "S2", courseId: "C1", rank: 1 },
        { studentId: "S3", courseId: "C1", rank: 1 },
      ],
      existingAllocations: [
        { studentId: "S1", courseId: "C1", phase: "merit" },
        { studentId: "S2", courseId: "C1", phase: "merit" },
        { studentId: "S3", courseId: "C1", phase: "merit" },
      ],
    });

    expect(result.courseSummary[0].totalAllocated).toBe(3);
    expect(result.courseSummary[0].totalAllocated).toBeLessThanOrEqual(4);
  });

  it("rejects an invalid random ratio", () => {
    expect(() =>
      allocateRandomPhase({
        students: [],
        courses: [],
        preferences: [],
      }, {
        randomRatio: 1.5,
      })
    ).toThrow("randomRatio must be between 0 and 1");
  });
});
