import { describe, it, expect } from "vitest";
import { generateRealistic, defaultSeatFactor, DEPARTMENTS } from "../../src/seed/generateRealistic.js";
import { courseKindProblem } from "../../src/utils/courseKind.js";

const gen = (o = {}) => generateRealistic({ semesterId: "SEM-1", size: 200, seed: 3, ...o });

describe("generateRealistic", () => {
  it("is deterministic for the same options and differs for another seed", () => {
    expect(gen()).toEqual(gen());
    expect(gen({ seed: 4 }).students.map((s) => s.cgpa)).not.toEqual(gen().students.map((s) => s.cgpa));
  });

  it("makes 30 open electives in one shared pool plus compulsory courses for every department", () => {
    const d = gen();
    const electives = d.courses.filter((c) => c.kind === "elective");
    const compulsory = d.courses.filter((c) => c.kind === "compulsory");
    expect(electives).toHaveLength(30);
    expect(electives.every((c) => c.electiveGroup === null && c.capacity >= 10 && c.timetableSlots.length >= 1)).toBe(true);
    for (const dept of DEPARTMENTS) {
      expect(compulsory.filter((c) => c.departments.includes(dept)).length).toBeGreaterThanOrEqual(4); // 2 institute + 2 own
    }
    // every course passes the same rule the model applies
    expect(d.courses.map((c) => courseKindProblem(c)).filter(Boolean)).toEqual([]);
    expect(new Set(d.courses.map((c) => c.courseCode)).size).toBe(d.courses.length);
  });

  it("every student submits a full 15-choice list per slot, of real distinct electives", () => {
    const d = gen({ size: 1000 });
    const codes = new Set(d.courses.filter((c) => c.kind === "elective").map((c) => c.courseCode));
    expect(d.preferences).toHaveLength(2000);
    expect(new Set(d.preferences.map((p) => p.studentId)).size).toBe(1000);
    for (const p of d.preferences) {
      expect(p.status).toBe("submitted");
      expect(p.courseCodes).toHaveLength(15);
      expect(new Set(p.courseCodes).size).toBe(15);
      expect(p.courseCodes.every((c) => codes.has(c))).toBe(true);
    }
    expect(d.students.every((s) => s.electiveGroups.length === 2)).toBe(true);
  });

  it("keeps a spread of CGPAs with ties, and imperfect students only when asked", () => {
    const d = gen({ size: 1000 });
    const cgpas = d.students.map((s) => s.cgpa);
    expect(Math.min(...cgpas)).toBeGreaterThanOrEqual(5);
    expect(Math.max(...cgpas)).toBeLessThanOrEqual(10);
    expect(new Set(cgpas).size).toBeLessThan(cgpas.length);

    const messy = gen({ size: 1000, unsubmittedShare: 0.05, draftShare: 0.05, oneSlotShare: 0.1 });
    expect(new Set(messy.preferences.map((p) => p.studentId)).size).toBeLessThan(1000);
    expect(messy.preferences.some((p) => p.status === "draft")).toBe(true);
    expect(messy.students.some((s) => s.electiveGroups.length === 1)).toBe(true);
  });

  it("names things Student0001 / IITISM0001 and Course1 / C1, continuing across semesters", () => {
    const first = gen({ semesterId: "SEM-1", size: 100 });
    const second = gen({ semesterId: "SEM-2", size: 100, studentOffset: 100, courseOffset: 30, compulsoryOffset: 12 });
    expect(first.students[0]).toMatchObject({ studentId: "IITISM0001", name: "Student0001" });
    expect(first.students.at(-1).studentId).toBe("IITISM0100");
    expect(second.students[0]).toMatchObject({ studentId: "IITISM0101", name: "Student0101" });
    const electives = (d) => d.courses.filter((c) => c.kind === "elective");
    expect(electives(first)[0]).toMatchObject({ courseCode: "C1", title: "Course1" });
    expect(electives(first).at(-1).courseCode).toBe("C30");
    expect(electives(second)[0]).toMatchObject({ courseCode: "C31", title: "Course31" });
    // different courses and different students in each semester
    const codes = (d) => d.courses.map((c) => c.courseCode);
    expect(codes(first).filter((c) => codes(second).includes(c))).toEqual([]);
    const ids = (d) => d.students.map((s) => s.studentId);
    expect(ids(first).filter((i) => ids(second).includes(i))).toEqual([]);
    // a student's list only names that semester's courses
    expect(second.preferences.every((p) => p.courseCodes.every((c) => codes(second).includes(c)))).toBe(true);
  });

  it("seats are tight for bigger intakes and the seat factor can be set", () => {
    expect(defaultSeatFactor(500)).toBeGreaterThan(defaultSeatFactor(1500));
    const tight = gen({ seatFactor: 0.7 });
    const loose = gen({ seatFactor: 1.5 });
    const seats = (d) => d.courses.reduce((n, c) => n + c.capacity, 0);
    expect(seats(tight)).toBeLessThan(seats(loose));
    expect(tight.meta.totalSeats).toBe(Math.round(200 * 2 * 0.7));
  });

  it("rejects bad options", () => {
    expect(() => generateRealistic({ size: 100 })).toThrow(/semesterId/);
    expect(() => gen({ size: 5 })).toThrow(/size/);
    expect(() => gen({ seatFactor: 9 })).toThrow(/seatFactor/);
  });
});
