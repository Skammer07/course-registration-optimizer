/**
 * tests/unit/compulsoryCourses.test.js
 * Compulsory courses: kind/department rules, the per-student fixed timetable,
 * the run fingerprint, and an end-to-end run through the real algorithm.
 * No database is needed (model validation runs without a connection).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import Course from "../../src/models/Course.js";
import { cleanDepartments, courseKindProblem } from "../../src/utils/courseKind.js";
import { createCourseSchema, updateCourseSchema } from "../../src/validators/course.schema.js";
import {
  buildFixedTimetable,
  isCompulsoryCourse,
  fingerprintInput,
  runSingle,
  _overrideSingleService,
} from "../../src/services/allocationEngine.service.js";
import { runSingleAllocation } from "../../../algorithm/src/services/singleAllocationService.js";

const slot = (day, start, end) => ({ day, start, end });

describe("kind rules", () => {
  it("cleans department lists: trims, drops blanks, removes case-insensitive duplicates", () => {
    expect(cleanDepartments([" CSE ", "cse", "", "ECE"])).toEqual(["CSE", "ECE"]);
    expect(cleanDepartments(undefined)).toEqual([]);
  });

  it("allows an elective with a group and no departments", () => {
    expect(courseKindProblem({ kind: "elective", electiveGroup: "A" })).toBeNull();
  });

  it("treats a course with no kind as an elective", () => {
    expect(courseKindProblem({ electiveGroup: "A" })).toBeNull();
  });

  it("requires departments on a compulsory course", () => {
    expect(courseKindProblem({ kind: "compulsory", departments: [] })).toMatch(/department/);
    expect(courseKindProblem({ kind: "compulsory", departments: ["CSE"] })).toBeNull();
  });

  it("does not allow a compulsory course in an elective group", () => {
    expect(
      courseKindProblem({ kind: "compulsory", electiveGroup: "A", departments: ["CSE"] })
    ).toMatch(/elective group/);
  });

  it("rejects an unknown kind", () => {
    expect(courseKindProblem({ kind: "optional" })).toMatch(/kind must be/);
  });
});

describe("Course model", () => {
  const base = { courseCode: "cs301", title: "T", semesterId: "S1" };

  it("defaults to an elective with no departments and requires capacity", () => {
    const doc = new Course({ ...base, electiveGroup: "A" });
    expect(doc.kind).toBe("elective");
    expect(doc.departments).toEqual([]);
    expect(doc.validateSync().errors.capacity).toBeDefined();
  });

  it("accepts a compulsory course without capacity and stores 0 seats", () => {
    const doc = new Course({ ...base, kind: "compulsory", departments: [" CSE "] });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.capacity).toBe(0);
    expect(doc.departments).toEqual(["CSE"]);
  });

  it("rejects a compulsory course with no departments or with an elective group", () => {
    expect(new Course({ ...base, kind: "compulsory" }).validateSync().errors.kind).toBeDefined();
    expect(
      new Course({ ...base, kind: "compulsory", departments: ["CSE"], electiveGroup: "A" })
        .validateSync().errors.kind
    ).toBeDefined();
  });
});

describe("request schemas", () => {
  const elective = {
    courseCode: "cs1", title: "T", semesterId: "S1", capacity: 10, electiveGroup: "A",
  };

  it("keeps existing elective requests valid and defaults kind", () => {
    const parsed = createCourseSchema.parse(elective);
    expect(parsed.kind).toBe("elective");
    expect(parsed.departments).toEqual([]);
  });

  it("still requires capacity for an elective", () => {
    const { capacity, ...noCapacity } = elective;
    const result = createCourseSchema.safeParse(noCapacity);
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe("Capacity is required");
  });

  it("accepts a compulsory course with departments and no capacity", () => {
    const result = createCourseSchema.safeParse({
      courseCode: "ma101", title: "Maths", semesterId: "S1",
      kind: "compulsory", departments: ["CSE", "ECE"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a compulsory course without departments or with a group", () => {
    const base = { courseCode: "ma101", title: "Maths", semesterId: "S1", kind: "compulsory" };
    expect(createCourseSchema.safeParse(base).success).toBe(false);
    expect(
      createCourseSchema.safeParse({ ...base, departments: ["CSE"], electiveGroup: "A" }).success
    ).toBe(false);
  });

  it("allows kind and departments in an update", () => {
    expect(updateCourseSchema.safeParse({ departments: ["CSE"] }).success).toBe(true);
  });
});

describe("buildFixedTimetable", () => {
  const students = [
    { studentId: "S1", department: "CSE" },
    { studentId: "S2", department: " cse " },
    { studentId: "S3", department: "ECE" },
    { studentId: "S4", department: "" },
  ];
  const maths = {
    courseCode: "MA101", kind: "compulsory", departments: ["CSE"],
    timetableSlots: [slot("Monday", "09:00", "09:50")],
  };

  it("gives each student the slots of the compulsory courses of their department", () => {
    const { fixedTimetable, messages } = buildFixedTimetable({
      students, compulsoryCourses: [maths],
    });

    // matching ignores case and spacing
    expect(Object.keys(fixedTimetable).sort()).toEqual(["S1", "S2"]);
    expect(fixedTimetable.S1).toEqual([slot("Monday", "09:00", "09:50")]);
    // S3 (ECE) and S4 (no department) get nothing, and the run says so
    expect(messages.join(" ")).toMatch(/2 student\(s\) have no matching compulsory course/);
  });

  it("combines several compulsory courses", () => {
    const physics = {
      courseCode: "PH101", kind: "compulsory", departments: ["CSE", "ECE"],
      timetableSlots: [slot("Tuesday", "10:00", "10:50")],
    };
    const { fixedTimetable } = buildFixedTimetable({ students, compulsoryCourses: [physics, maths] });

    // ordered by course code, so the result does not depend on database order
    expect(fixedTimetable.S1).toEqual([
      slot("Monday", "09:00", "09:50"),
      slot("Tuesday", "10:00", "10:50"),
    ]);
    expect(fixedTimetable.S3).toEqual([slot("Tuesday", "10:00", "10:50")]);
  });

  it("returns null when there are no compulsory courses", () => {
    expect(buildFixedTimetable({ students, compulsoryCourses: [] })).toEqual({
      fixedTimetable: null, messages: [],
    });
  });

  it("warns about a compulsory course without slots, which cannot block anything", () => {
    const { fixedTimetable, messages } = buildFixedTimetable({
      students,
      compulsoryCourses: [{ courseCode: "MA102", kind: "compulsory", departments: ["CSE"], timetableSlots: [] }],
    });
    expect(fixedTimetable).toBeNull();
    expect(messages[0]).toMatch(/MA102/);
  });

  it("recognises compulsory courses", () => {
    expect(isCompulsoryCourse(maths)).toBe(true);
    expect(isCompulsoryCourse({ courseCode: "X" })).toBe(false);
    expect(isCompulsoryCourse({ kind: "elective" })).toBe(false);
  });
});

describe("fingerprintInput", () => {
  const input = {
    algStudents: [{ id: "S1", name: "A", cgpa: 9 }],
    algCourses: [{ id: "C1", name: "C", capacity: 1 }],
    algPreferences: [{ studentId: "S1", courseId: "C1", rank: 1 }],
    timetable: { C1: [slot("Monday", "09:00", "09:50")] },
  };

  it("is unchanged when no compulsory slots are used", () => {
    expect(fingerprintInput({ ...input, fixedTimetable: null })).toBe(fingerprintInput(input));
  });

  it("changes when compulsory slots are added or changed", () => {
    const a = fingerprintInput({ ...input, fixedTimetable: { S1: [slot("Monday", "09:00", "09:50")] } });
    const b = fingerprintInput({ ...input, fixedTimetable: { S1: [slot("Monday", "10:00", "10:50")] } });
    expect(a).not.toBe(fingerprintInput(input));
    expect(a).not.toBe(b);
  });
});

describe("a run through the real algorithm", () => {
  beforeEach(() => _overrideSingleService({ runSingleAllocation }));
  afterEach(() => _overrideSingleService(null));

  const students = [{ studentId: "S1", name: "A", cgpa: 9, department: "CSE" }];
  const courses = [
    { courseCode: "E1", title: "Overlaps maths", capacity: 5, electiveGroup: "A", timetableSlots: [slot("Monday", "09:30", "10:20")] },
    { courseCode: "E2", title: "Free", capacity: 5, electiveGroup: "A", timetableSlots: [slot("Tuesday", "09:00", "09:50")] },
  ];
  const preferences = [
    {
      student: { studentId: "S1" },
      electiveGroup: "A",
      rankedCourseIds: [{ courseCode: "E1" }, { courseCode: "E2" }],
    },
  ];
  const maths = {
    courseCode: "MA101", kind: "compulsory", departments: ["CSE"],
    timetableSlots: [slot("Monday", "09:00", "09:50")],
  };

  for (const algorithm of ["baseline", "optimized"]) {
    it(`${algorithm}: never gives an elective that overlaps a compulsory course`, async () => {
      const { fixedTimetable } = buildFixedTimetable({ students, compulsoryCourses: [maths] });

      const { result, inputSnapshot } = await runSingle({
        algorithm, students, courses, preferences, fixedTimetable,
        options: { seed: 1 },
      });

      expect(result.allocations.map((a) => a.courseId)).toEqual(["E2"]);
      expect(result.metrics.timetableClashes).toBe(0);
      expect(inputSnapshot.fixedTimetable).toEqual({ S1: [slot("Monday", "09:00", "09:50")] });
    });
  }

  it("ignores compulsory slots when the timetable check is off", async () => {
    const { fixedTimetable } = buildFixedTimetable({ students, compulsoryCourses: [maths] });

    const { result, inputSnapshot } = await runSingle({
      algorithm: "optimized", students, courses, preferences, fixedTimetable,
      includeTimetable: false, options: {},
    });

    // E1 is the student's first choice and is not blocked now (E1 and E2 share a group, so only one is given)
    expect(result.allocations.map((a) => a.courseId)).toEqual(["E1"]);
    expect(inputSnapshot.fixedTimetable).toBeNull();
  });
});
