
import { describe, it, expect } from "vitest";
import { runAllocation } from "../src/algorithms/allocationPipeline.js";

describe("Complete allocation pipeline", () => {
  it("runs merit allocation before random allocation", () => {
    const input = {
      students: [
        { id: "S1", cgpa: 9 },
        { id: "S2", cgpa: 8 },
        { id: "S3", cgpa: 7 },
        { id: "S4", cgpa: 6 },
      ],
      courses: [{ id: "C1", capacity: 4 }],
      preferences: [
        { studentId: "S1", courseId: "C1", rank: 1 },
        { studentId: "S2", courseId: "C1", rank: 1 },
        { studentId: "S3", courseId: "C1", rank: 1 },
        { studentId: "S4", courseId: "C1", rank: 1 },
      ],
    };

    const result = runAllocation(input, {
      random: () => 0.5,
    });

    expect(result.phaseSummary.merit.allocated).toBe(3);
    expect(result.phaseSummary.random.allocated).toBe(1);
    expect(result.allocations).toHaveLength(4);
  });

  it("allows a student to receive two courses during merit", () => {
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

    const result = runAllocation(input, {
      random: () => 0.5,
    });

    const s1 = result.allocations.filter(
      allocation => allocation.studentId === "S1"
    );

    expect(s1).toHaveLength(2);
    expect(s1.every(a => a.phase === "merit")).toBe(true);
    expect(s1.some(a => a.iteration === 1)).toBe(true);
    expect(s1.some(a => a.iteration === 2)).toBe(true);
  });

  it("never gives a student more than two courses", () => {
    const input = {
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
        { studentId: "S1", courseId: "C1", rank: 1 },
        { studentId: "S1", courseId: "C2", rank: 2 },
        { studentId: "S1", courseId: "C3", rank: 3 },
        { studentId: "S2", courseId: "C1", rank: 1 },
        { studentId: "S2", courseId: "C2", rank: 2 },
        { studentId: "S2", courseId: "C3", rank: 3 },
      ],
    };

    const result = runAllocation(input, {
      random: () => 0.5,
    });

    for (const student of input.students) {
      const studentAllocations = result.allocations.filter(
        allocation => allocation.studentId === student.id
      );

      expect(studentAllocations.length).toBeLessThanOrEqual(2);
    }
  });

  it("does not allocate the same course to a student twice", () => {
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

    const result = runAllocation(input, {
      random: () => 0.5,
    });

    const pairs = result.allocations.map(
      allocation =>
        `${allocation.studentId}:${allocation.courseId}`
    );

    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("never exceeds a course's physical capacity", () => {
    const input = {
      students: [
        { id: "S1", cgpa: 9 },
        { id: "S2", cgpa: 8 },
        { id: "S3", cgpa: 7 },
        { id: "S4", cgpa: 6 },
      ],
      courses: [{ id: "C1", capacity: 4 }],
      preferences: [
        { studentId: "S1", courseId: "C1", rank: 1 },
        { studentId: "S2", courseId: "C1", rank: 1 },
        { studentId: "S3", courseId: "C1", rank: 1 },
        { studentId: "S4", courseId: "C1", rank: 1 },
      ],
    };

    const result = runAllocation(input, {
      random: () => 0.5,
    });

    expect(
      result.allocations.filter(a => a.courseId === "C1").length
    ).toBeLessThanOrEqual(4);
  });

  it("rejects malformed input", () => {
    expect(() => runAllocation({})).toThrow();
  });
});
