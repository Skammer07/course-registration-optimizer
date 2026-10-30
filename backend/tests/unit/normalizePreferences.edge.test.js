/**
 * tests/unit/normalizePreferences.edge.test.js
 * Edge-case unit tests for preference normalization
 * (preference ranking, timetable map, algorithm input contract).
 */

import { describe, it, expect } from "vitest";
import {
  normalizeStudents,
  normalizeCourses,
  normalizePreferences,
  buildTimetableMap,
} from "../../src/services/allocationEngine.service.js";

describe("normalizePreferences — edge cases", () => {
  it("assigns ranks starting at 1 (not 0)", () => {
    const prefs = [
      {
        student: { studentId: "S001" },
        rankedCourseIds: [{ courseCode: "CS301" }, { courseCode: "CS302" }, { courseCode: "CS303" }],
      },
    ];
    const result = normalizePreferences(prefs);
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(2);
    expect(result[2].rank).toBe(3);
  });

  it("handles multiple students correctly without cross-contamination", () => {
    const prefs = [
      {
        student: { studentId: "S001" },
        rankedCourseIds: [{ courseCode: "CS301" }],
      },
      {
        student: { studentId: "S002" },
        rankedCourseIds: [{ courseCode: "CS302" }],
      },
    ];
    const result = normalizePreferences(prefs);
    expect(result).toHaveLength(2);
    expect(result.find(p => p.studentId === "S001").courseId).toBe("CS301");
    expect(result.find(p => p.studentId === "S002").courseId).toBe("CS302");
  });

  it("skips courses with no courseCode (malformed populated doc)", () => {
    const prefs = [
      {
        student: { studentId: "S001" },
        rankedCourseIds: [null, { courseCode: "CS302" }],
      },
    ];
    const result = normalizePreferences(prefs);
    // null entry should be skipped, CS302 should have rank 2 (its original position)
    expect(result.some(p => p.courseId === "CS302")).toBe(true);
  });

  it("produces no duplicate studentId+courseId pairs for a single preference doc", () => {
    const prefs = [
      {
        student: { studentId: "S001" },
        rankedCourseIds: [{ courseCode: "CS301" }, { courseCode: "CS302" }],
      },
    ];
    const result = normalizePreferences(prefs);
    const pairs = result.map(p => `${p.studentId}::${p.courseId}`);
    expect(pairs.length).toBe(new Set(pairs).size);
  });
});

describe("buildTimetableMap — edge cases", () => {
  it("omits courses with empty slot arrays from the map", () => {
    const courses = [
      {
        courseCode: "CS301",
        timetableSlots: [{ day: "Monday", start: "09:00", end: "09:50" }],
      },
      {
        courseCode: "CS302",
        timetableSlots: [], // no slots
      },
    ];
    const result = buildTimetableMap(courses);
    expect(result).toBeTruthy();
    expect(result["CS301"]).toBeDefined();
    expect(result["CS302"]).toBeUndefined(); // Not included
  });

  it("preserves all slot fields exactly", () => {
    const courses = [
      {
        courseCode: "CS401",
        timetableSlots: [
          { day: "Tuesday", start: "10:00", end: "10:50" },
          { day: "Thursday", start: "10:00", end: "10:50" },
        ],
      },
    ];
    const result = buildTimetableMap(courses);
    expect(result["CS401"]).toHaveLength(2);
    expect(result["CS401"][1]).toEqual({ day: "Thursday", start: "10:00", end: "10:50" });
  });
});

describe("normalizeStudents — edge cases", () => {
  it("preserves exact cgpa values including decimals", () => {
    const students = [{ studentId: "S001", name: "Test", cgpa: 9.75 }];
    const result = normalizeStudents(students);
    expect(result[0].cgpa).toBe(9.75);
  });

  it("uses studentId as id (not MongoDB _id)", () => {
    const students = [{ _id: "mongo-id", studentId: "20JE0001", name: "A", cgpa: 8.0 }];
    const result = normalizeStudents(students);
    expect(result[0].id).toBe("20JE0001");
    expect(result[0]._id).toBeUndefined();
  });
});

describe("normalizeCourses — edge cases", () => {
  it("uses courseCode as id (not MongoDB _id)", () => {
    const courses = [{ _id: "mongo-id", courseCode: "CS301", title: "DS", capacity: 60 }];
    const result = normalizeCourses(courses);
    expect(result[0].id).toBe("CS301");
    expect(result[0]._id).toBeUndefined();
  });

  it("uses title as name (not courseCode)", () => {
    const courses = [{ courseCode: "CS301", title: "Data Structures", capacity: 60 }];
    const result = normalizeCourses(courses);
    expect(result[0].name).toBe("Data Structures");
  });
});

