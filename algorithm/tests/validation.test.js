
import { describe, it, expect } from "vitest";
import { validateAllocation } from "../src/validation/validateAllocation.js";

const students = [
  { id: "S1", cgpa: 9.5 },
  { id: "S2", cgpa: 8.0 },
  { id: "S3", cgpa: 7.0 },
];

const courses = [
  { id: "C1", capacity: 2 },
  { id: "C2", capacity: 2 },
  { id: "C3", capacity: 1 },
];

const preferences = [
  { studentId: "S1", courseId: "C1", rank: 1 },
  { studentId: "S1", courseId: "C2", rank: 2 },
  { studentId: "S2", courseId: "C1", rank: 1 },
  { studentId: "S2", courseId: "C2", rank: 2 },
  { studentId: "S3", courseId: "C2", rank: 1 },
  { studentId: "S3", courseId: "C3", rank: 2 },
];

describe("Allocation validation", () => {
  it("accepts valid allocations", () => {
    const result = validateAllocation({
      students,
      courses,
      preferences,
      allocations: [
        { studentId: "S1", courseId: "C1" },
        { studentId: "S2", courseId: "C1" },
        { studentId: "S3", courseId: "C2" },
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects unknown students and courses", () => {
    const result = validateAllocation({
      students,
      courses,
      preferences,
      allocations: [
        { studentId: "S99", courseId: "C1" },
        { studentId: "S1", courseId: "C99" },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("unknown student"))).toBe(true);
    expect(result.errors.some((e) => e.includes("unknown course"))).toBe(true);
  });

  it("rejects duplicate assignments", () => {
    const result = validateAllocation({
      students,
      courses,
      preferences,
      allocations: [
        { studentId: "S1", courseId: "C1" },
        { studentId: "S1", courseId: "C1" },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate assignment"))).toBe(true);
  });

  it("rejects course capacity violations", () => {
    const result = validateAllocation({
      students,
      courses,
      preferences,
      allocations: [
        { studentId: "S1", courseId: "C1" },
        { studentId: "S2", courseId: "C1" },
        { studentId: "S3", courseId: "C1" },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("exceeds capacity"))).toBe(true);
  });

  it("rejects students exceeding their course limit", () => {
    const result = validateAllocation({
      students,
      courses,
      preferences,
      allocations: [
        { studentId: "S1", courseId: "C1" },
        { studentId: "S1", courseId: "C2" },
        { studentId: "S1", courseId: "C3" },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("course limit"))).toBe(true);
  });

  it("rejects assignments outside student preferences", () => {
    const result = validateAllocation({
      students,
      courses,
      preferences,
      allocations: [{ studentId: "S1", courseId: "C3" }],
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("did not select course"))).toBe(true);
  });

  it("rejects timetable clashes", () => {
    const result = validateAllocation({
      students,
      courses,
      preferences,
      allocations: [
        { studentId: "S1", courseId: "C1" },
        { studentId: "S1", courseId: "C2" },
      ],
      timetable: {
        C1: [{ day: "Monday", start: "09:00", end: "10:00" }],
        C2: [{ day: "Monday", start: "09:30", end: "10:30" }],
        C3: [],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("timetable clash"))).toBe(true);
  });
});
