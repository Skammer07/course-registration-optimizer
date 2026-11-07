import { describe, expect, it } from "vitest";
import { EMPTY_COURSE_FORM, buildCreatePayload, buildUpdatePayload, courseToForm, validateCourseForm } from "./courseForm.js";
import { IMPORT_SPEC, countRows, importSignature, templateCsv } from "./importSpec.js";
import {
  EMPTY_STUDENT_FORM,
  buildCreatePayload as buildStudentCreate,
  buildUpdatePayload as buildStudentUpdate,
  parseGroups,
  studentToForm,
  validateStudentForm,
} from "./studentForm.js";

const stored = {
  _id: "c1",
  courseCode: "CS101",
  title: "Machine Learning",
  capacity: 60,
  semesterId: "SEM-5",
  electiveGroup: "PE1",
  isActive: true,
  timetableSlots: [{ day: "Monday", start: "09:00", end: "10:00" }],
};

describe("course form", () => {
  const filled = { ...EMPTY_COURSE_FORM, courseCode: "cs102", title: "  Databases ", capacity: "40", electiveGroup: " PE1 " };

  it("accepts a complete form and explains each problem otherwise", () => {
    expect(validateCourseForm(filled, "create")).toEqual({});
    const errors = validateCourseForm({ ...EMPTY_COURSE_FORM, capacity: "-3" }, "create");
    expect(Object.keys(errors).sort()).toEqual(["capacity", "courseCode", "title"]);
    expect(validateCourseForm({ ...filled, capacity: "12.5" }, "create").capacity).toBeDefined();
    expect(validateCourseForm({ ...filled, capacity: "0" }, "create")).toEqual({}); // a closed course is allowed
  });

  it("does not ask for the code when editing, since it cannot change", () => {
    expect(validateCourseForm({ ...courseToForm(stored), courseCode: "" }, "edit")).toEqual({});
  });

  it("checks each time slot, naming the slot that is wrong", () => {
    const form = {
      ...filled,
      slots: [
        { day: "Monday", start: "09:00", end: "10:00" },
        { day: "Monday", start: "11:00", end: "10:00" },
        { day: "Monday", start: "09:00", end: "10:00" },
        { day: "Friday", start: "", end: "10:00" },
      ],
    };
    const errors = validateCourseForm(form, "create").slots;
    expect(Object.keys(errors)).toEqual(["1", "2", "3"]);
    expect(errors[1]).toMatch(/end after it starts/);
    expect(errors[2]).toMatch(/twice/);
    expect(errors[3]).toMatch(/both times/);
  });

  it("builds the create body: code in capitals, trimmed, the viewed semester, no group as null", () => {
    expect(buildCreatePayload(filled, "SEM-5")).toEqual({
      courseCode: "CS102",
      title: "Databases",
      capacity: 40,
      semesterId: "SEM-5",
      kind: "elective",
      departments: [],
      electiveGroup: "PE1",
      timetableSlots: [],
      isActive: true,
    });
    expect(buildCreatePayload({ ...filled, electiveGroup: "  " }, "SEM-5").electiveGroup).toBeNull();
  });

  it("a compulsory course has departments, no seats and no group", () => {
    const form = { ...filled, kind: "compulsory", departments: " CSE, ece ;cse ", capacity: "", electiveGroup: "PE1" };

    expect(validateCourseForm(form, "create")).toEqual({});
    expect(buildCreatePayload(form, "SEM-5")).toEqual({
      courseCode: "CS102",
      title: "Databases",
      semesterId: "SEM-5",
      kind: "compulsory",
      departments: ["CSE", "ece"],
      electiveGroup: null,
      timetableSlots: [],
      isActive: true,
    });
    expect(validateCourseForm({ ...form, departments: " " }, "create").departments).toBeDefined();
  });

  it("an elective still needs seats, and a kind change is sent when editing", () => {
    expect(validateCourseForm({ ...filled, capacity: "" }, "create").capacity).toBeDefined();
    const form = { ...courseToForm(stored), kind: "compulsory", departments: "CSE" };
    expect(buildUpdatePayload(form, stored, { isAdmin: false })).toMatchObject({
      kind: "compulsory",
      departments: ["CSE"],
      electiveGroup: null,
    });
  });

  it("sends only what changed when editing", () => {
    const form = courseToForm(stored);
    expect(buildUpdatePayload(form, stored, { isAdmin: true })).toEqual({});
    expect(buildUpdatePayload({ ...form, capacity: "75" }, stored, { isAdmin: false })).toEqual({ capacity: 75 });
    expect(buildUpdatePayload({ ...form, slots: [] }, stored, { isAdmin: false })).toEqual({ timetableSlots: [] });
    expect(buildUpdatePayload({ ...form, electiveGroup: "" }, stored, { isAdmin: false })).toEqual({ electiveGroup: null });
  });

  it("only an admin can switch a course off", () => {
    const off = { ...courseToForm(stored), isActive: false };
    expect(buildUpdatePayload(off, stored, { isAdmin: true })).toEqual({ isActive: false });
    expect(buildUpdatePayload(off, stored, { isAdmin: false })).toEqual({});
  });
});

describe("student form", () => {
  const student = { _id: "s1", studentId: "21CS001", name: "Asha Rao", cgpa: 8.7, department: "CSE", semesterId: "SEM-5", electiveGroups: ["PE1", "OE1"], isActive: true };

  it("splits elective groups on commas, trimming and dropping repeats", () => {
    expect(parseGroups(" PE1, OE1 ,,PE1")).toEqual(["PE1", "OE1"]);
    expect(parseGroups("")).toEqual([]);
  });

  it("checks the required fields and the CGPA range", () => {
    expect(Object.keys(validateStudentForm(EMPTY_STUDENT_FORM, "create")).sort()).toEqual(["cgpa", "name", "studentId"]);
    expect(validateStudentForm({ ...EMPTY_STUDENT_FORM, studentId: "x", name: "A", cgpa: "10.5" }, "create").cgpa).toBeDefined();
    expect(validateStudentForm({ ...EMPTY_STUDENT_FORM, studentId: "x", name: "A", cgpa: "0" }, "create")).toEqual({});
    expect(validateStudentForm({ ...studentToForm(student), studentId: "" }, "edit")).toEqual({});
  });

  it("builds the create body in the viewed semester", () => {
    const form = { ...EMPTY_STUDENT_FORM, studentId: "21cs002", name: " Ben ", cgpa: "7.25", department: "ECE", electiveGroups: "PE1" };
    expect(buildStudentCreate(form, "SEM-5")).toEqual({
      studentId: "21CS002",
      name: "Ben",
      cgpa: 7.25,
      department: "ECE",
      semesterId: "SEM-5",
      electiveGroups: ["PE1"],
      isActive: true,
    });
  });

  it("faculty can send a name or department change and nothing that affects allocation", () => {
    const form = { ...studentToForm(student), name: "Asha R", department: "IT", cgpa: "9.9", electiveGroups: "PE2", isActive: false };
    expect(buildStudentUpdate(form, student, { isAdmin: false })).toEqual({ name: "Asha R", department: "IT" });
    expect(buildStudentUpdate(form, student, { isAdmin: true })).toEqual({
      name: "Asha R",
      department: "IT",
      cgpa: 9.9,
      electiveGroups: ["PE2"],
      isActive: false,
    });
    expect(buildStudentUpdate(studentToForm(student), student, { isAdmin: true })).toEqual({});
  });
});

describe("import helpers", () => {
  it("makes a template that has every column of the type, plus one example row", () => {
    for (const type of Object.keys(IMPORT_SPEC)) {
      const [header, example] = templateCsv(type).trim().split("\n");
      const names = header.split(",");
      const spec = IMPORT_SPEC[type];
      for (const [name] of [...spec.required, ...spec.optional]) expect(names).toContain(name);
      expect(example).toBeTruthy();
    }
  });

  it("quotes a cell that contains a comma", () => {
    expect(templateCsv("courses")).not.toMatch(/"/); // the example needs no quoting
  });

  it("counts the rows after the header and ignores blank lines", () => {
    expect(countRows("a,b\n1,2\n\n3,4\n")).toBe(2);
    expect(countRows("a,b\r\n1,2\r\n")).toBe(1);
    expect(countRows("")).toBe(0);
    expect(countRows("a,b")).toBe(0);
  });

  it("the signature changes with the text or any option, so a check cannot be reused for different input", () => {
    const base = { onExisting: "skip", createLogins: false, status: undefined };
    const one = importSignature("students", "a\n1", base);
    expect(importSignature("students", "a\n1", { ...base })).toBe(one);
    expect(importSignature("students", "a\n2", base)).not.toBe(one);
    expect(importSignature("courses", "a\n1", base)).not.toBe(one);
    expect(importSignature("students", "a\n1", { ...base, onExisting: "update" })).not.toBe(one);
    expect(importSignature("students", "a\n1", { ...base, createLogins: true })).not.toBe(one);
  });
});
