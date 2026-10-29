
import { describe, it, expect } from "vitest";
import {
  hasTimetableClash,
  createTimetableCanEnroll
} from "../src/timetable/checkClash.js";

const timetable = {
  C1: [
    { day: "Monday", start: "09:00", end: "09:50" },
    { day: "Wednesday", start: "09:00", end: "09:50" }
  ],
  C2: [
    { day: "Monday", start: "09:00", end: "09:50" },
    { day: "Thursday", start: "10:00", end: "10:50" }
  ],
  C3: [
    { day: "Tuesday", start: "11:00", end: "11:50" },
    { day: "Friday", start: "11:00", end: "11:50" }
  ],
  C4: [
    { day: "Monday", start: "09:50", end: "10:40" }
  ]
};

describe("Timetable clash detection", () => {
  it("detects courses with overlapping slots", () => {
    expect(
      hasTimetableClash("C2", [{ courseId: "C1" }], timetable)
    ).toBe(true);
  });

  it("allows courses with no overlapping slots", () => {
    expect(
      hasTimetableClash("C3", [{ courseId: "C1" }], timetable)
    ).toBe(false);
  });

  it("does not treat adjacent slots as a clash", () => {
    expect(
      hasTimetableClash("C4", [{ courseId: "C1" }], timetable)
    ).toBe(false);
  });

  it("checks all courses already allocated to a student", () => {
    expect(
      hasTimetableClash(
        "C2",
        [{ courseId: "C3" }, { courseId: "C1" }],
        timetable
      )
    ).toBe(true);
  });

  it("allows a course when the student has no existing allocations", () => {
    expect(hasTimetableClash("C1", [], timetable)).toBe(false);
  });

  it("rejects a course with missing timetable data", () => {
    expect(() =>
      hasTimetableClash("UNKNOWN", [], timetable)
    ).toThrow(/Missing timetable slots/);
  });

  it("integrates with the allocation canEnroll hook", () => {
    const canEnroll = createTimetableCanEnroll(timetable);

    const student = { id: "S1", cgpa: 9 };
    const existingAllocations = [
      { studentId: "S1", courseId: "C1" }
    ];

    expect(
      canEnroll(student, { id: "C2" }, existingAllocations)
    ).toBe(false);

    expect(
      canEnroll(student, { id: "C3" }, existingAllocations)
    ).toBe(true);
  });
});
