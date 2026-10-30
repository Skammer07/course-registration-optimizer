/**
 * tests/unit/prepareInputs.test.js
 * Stale records must be excluded and REPORTED before the algorithm runs,
 * instead of crashing the whole run.
 */

import { describe, it, expect } from "vitest";
import { prepareInputs, runComparison } from "../../src/services/allocationEngine.service.js";

const slot = (day) => [{ day, start: "09:00", end: "10:00" }];
const students = [
  { studentId: "S1", name: "A", cgpa: 9 },
  { studentId: "S2", name: "B", cgpa: 8 },
];
const courses = [
  { courseCode: "C1", title: "C1", capacity: 2, electiveGroup: "A", timetableSlots: slot("Monday") },
  { courseCode: "C2", title: "C2", capacity: 2, electiveGroup: "A", timetableSlots: slot("Tuesday") },
];
const c = (code) => ({ courseCode: code, electiveGroup: "A" });
const pref = (sid, codes) => ({ student: { studentId: sid }, electiveGroup: "A", rankedCourseIds: codes.map(c) });

describe("prepareInputs", () => {
  it("passes clean data through untouched with zero warnings", () => {
    const prefs = [pref("S1", ["C1", "C2"]), pref("S2", ["C1"])];
    const out = prepareInputs({ students, courses, preferences: prefs });
    expect(out.preferences).toEqual(prefs);
    expect(out.warnings).toEqual({ skippedPreferences: 0, droppedCourseEntries: 0, messages: [] });
  });

  it("skips a preference list from a student who is not active in the run, and reports it", () => {
    const out = prepareInputs({ students, courses, preferences: [pref("S1", ["C1"]), pref("S9", ["C1"])] });
    expect(out.preferences).toHaveLength(1);
    expect(out.warnings.skippedPreferences).toBe(1);
    expect(out.warnings.messages.join(" ")).toMatch(/S9/);
  });

  it("drops inactive/withdrawn courses from a list, keeps the order of the rest", () => {
    const out = prepareInputs({ students, courses, preferences: [pref("S1", ["C1", "C9", "C2"])] });
    expect(out.preferences[0].rankedCourseIds.map((x) => x.courseCode)).toEqual(["C1", "C2"]);
    expect(out.warnings.droppedCourseEntries).toBe(1);
    expect(out.warnings.messages.join(" ")).toMatch(/S1/);
  });

  it("tolerates a null entry (course deleted after submission)", () => {
    const p = { ...pref("S1", ["C1"]), rankedCourseIds: [null, c("C1")] };
    const out = prepareInputs({ students, courses, preferences: [p] });
    expect(out.preferences[0].rankedCourseIds).toHaveLength(1);
    expect(out.warnings.droppedCourseEntries).toBe(1);
  });

  it("skips a list left with no active courses", () => {
    const out = prepareInputs({ students, courses, preferences: [pref("S1", ["C1"]), pref("S2", ["C8", "C9"])] });
    expect(out.preferences).toHaveLength(1);
    expect(out.warnings.skippedPreferences).toBe(1);
  });

  it("rejects (400) when nothing usable remains", () => {
    expect(() => prepareInputs({ students, courses, preferences: [pref("S9", ["C1"])] })).toThrow(
      expect.objectContaining({ statusCode: 400 })
    );
  });

  it("rejects (400) a partly filled-in timetable and names the courses", () => {
    const mixed = [courses[0], { ...courses[1], timetableSlots: [] }];
    expect(() => prepareInputs({ students, courses: mixed, preferences: [pref("S1", ["C1"])] })).toThrow(
      expect.objectContaining({ statusCode: 400, message: expect.stringContaining("C2") })
    );
  });

  it("allows a fully empty timetable, and a partial one when the timetable is disabled", () => {
    const none = courses.map((x) => ({ ...x, timetableSlots: [] }));
    expect(() => prepareInputs({ students, courses: none, preferences: [pref("S1", ["C1"])] })).not.toThrow();
    const mixed = [courses[0], { ...courses[1], timetableSlots: [] }];
    expect(() =>
      prepareInputs({ students, courses: mixed, preferences: [pref("S1", ["C1"])], includeTimetable: false })
    ).not.toThrow();
  });

  it("the previously crashing stale data now runs end to end after preparation", async () => {
    const stale = [pref("S1", ["C1", "C9"]), pref("S2", ["C1"]), pref("S9", ["C1"])];
    await expect(runComparison({ students, courses, preferences: stale, options: { seed: 1 } })).rejects.toThrow(
      /Invalid preference/
    );
    const { preferences } = prepareInputs({ students, courses, preferences: stale });
    const out = await runComparison({ students, courses, preferences, options: { seed: 1 } });
    expect(out.result.baseline.validation.valid).toBe(true);
    expect(out.result.optimized.validation.valid).toBe(true);
  });
});
