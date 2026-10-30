/**
 * tests/unit/courseTimetable.model.test.js
 * Model-level timetable validation (no database needed: validateSync and the
 * array validator that Mongoose also applies for update validators), the
 * shared validator, and clash detection edge cases.
 */

import { describe, it, expect } from "vitest";
import Course from "../../src/models/Course.js";
import { isValidSlot, timeToMinutes } from "../../src/utils/timetable.js";
import { updateCourseSchema } from "../../src/validators/course.schema.js";
import { hasTimetableClash } from "../../../algorithm/src/timetable/checkClash.js";

const base = { courseCode: "cs1", title: "T", capacity: 5, semesterId: "S1" };
const slot = (start, end, day = "Monday") => ({ day, start, end });
const errorsFor = (slots) =>
  new Course({ ...base, timetableSlots: slots }).validateSync();

describe("Course model timetable validation", () => {
  it("accepts boundary times 00:00-23:59", () => {
    expect(errorsFor([slot("00:00", "23:59")])).toBeUndefined();
    expect(errorsFor([slot("00:00", "00:01")])).toBeUndefined();
  });

  it("accepts a course with no slots", () => {
    expect(errorsFor([])).toBeUndefined();
  });

  it.each([
    ["29:90", "30:00"],
    ["24:00", "25:00"],
    ["09:60", "10:00"],
    ["9:00", "10:00"],
    ["09:00", "ten"],
  ])("rejects invalid time %s-%s", (s, e) => {
    expect(errorsFor([slot(s, e)])).toBeDefined();
  });

  it("rejects equal start and end", () => {
    expect(errorsFor([slot("10:00", "10:00")])).toBeDefined();
  });

  it("rejects start later than end", () => {
    expect(errorsFor([slot("11:00", "10:00")])).toBeDefined();
  });

  it("rejects an invalid weekday", () => {
    expect(errorsFor([slot("09:00", "10:00", "Funday")])).toBeDefined();
    expect(errorsFor([slot("09:00", "10:00", "monday")])).toBeDefined();
  });

  it("one bad slot among valid ones invalidates the course (full-array update path)", () => {
    const err = errorsFor([slot("09:00", "10:00"), slot("12:00", "11:00", "Tuesday")]);
    expect(err).toBeDefined();
    expect(Object.keys(err.errors).join(",")).toMatch(/timetableSlots/);
  });

  it("the array validator (also applied by update validators) accepts/rejects correctly", () => {
    const { validators } = Course.schema.path("timetableSlots");
    const arrayValidator = validators.find((v) => /timetable slot/.test(v.message)).validator;
    expect(arrayValidator([slot("09:00", "10:00")])).toBe(true);
    expect(arrayValidator([slot("10:00", "09:00")])).toBe(false);
    expect(arrayValidator([slot("29:90", "30:00")])).toBe(false);
  });

  it("Zod request schema and the model agree (shared validator)", () => {
    for (const s of [
      slot("09:00", "10:00"),
      slot("10:00", "10:00"),
      slot("29:90", "30:00"),
      slot("09:00", "10:00", "Nope"),
    ]) {
      expect(updateCourseSchema.safeParse({ timetableSlots: [s] }).success).toBe(isValidSlot(s));
      expect(errorsFor([s]) === undefined).toBe(isValidSlot(s));
    }
    expect(timeToMinutes("23:59")).toBe(1439);
  });

  it("partial updates: omitting timetableSlots is fine, supplying a bad one is not", () => {
    expect(updateCourseSchema.safeParse({ title: "New" }).success).toBe(true);
    expect(updateCourseSchema.safeParse({ timetableSlots: [slot("12:00", "11:00")] }).success).toBe(false);
  });
});

describe("timetable clash detection", () => {
  const clash = (a, b) =>
    hasTimetableClash("B", [{ courseId: "A" }], { A: [a], B: [b] });

  it("identical start times clash", () => {
    expect(clash(slot("09:00", "09:50"), slot("09:00", "10:30"))).toBe(true);
  });
  it("nested intervals clash", () => {
    expect(clash(slot("09:00", "12:00"), slot("10:00", "11:00"))).toBe(true);
    expect(clash(slot("10:00", "11:00"), slot("09:00", "12:00"))).toBe(true);
  });
  it("partial overlaps clash", () => {
    expect(clash(slot("09:00", "10:00"), slot("09:30", "10:30"))).toBe(true);
    expect(clash(slot("09:30", "10:30"), slot("09:00", "10:00"))).toBe(true);
  });
  it("adjacent intervals do not clash", () => {
    expect(clash(slot("09:00", "10:00"), slot("10:00", "11:00"))).toBe(false);
  });
  it("same time on different days does not clash", () => {
    expect(clash(slot("09:00", "10:00"), slot("09:00", "10:00", "Tuesday"))).toBe(false);
  });
});
