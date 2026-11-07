import { afterEach, describe, expect, it, vi } from "vitest";
import { describeSemester, pickInitialSemester, semesterProblems } from "./SemesterPicker.jsx";
import { readLastSemester, rememberSemester } from "../../lib/storage.js";

const sem = (semesterId, patch = {}) => ({ semesterId, name: "", recordExists: false, students: 30, courses: 8, preferenceLists: 60, runs: 0, published: false, ...patch });

describe("describeSemester", () => {
  it("summarises what the semester holds, with correct plurals", () => {
    expect(describeSemester(sem("A"))).toBe("30 students · 8 courses · 60 submitted preference lists");
    expect(describeSemester(sem("A", { students: 1, courses: 1, preferenceLists: 1 }))).toBe("1 student · 1 course · 1 submitted preference list");
    expect(describeSemester(sem("A", { runs: 1 }))).toMatch(/· 1 run so far$/);
    expect(describeSemester(sem("A", { runs: 3 }))).toMatch(/· 3 runs so far$/);
  });
});

describe("pickInitialSemester", () => {
  it("prefers the semester used last time, if it still exists", () => {
    expect(pickInitialSemester([sem("A"), sem("B")], "B")).toBe("B");
    expect(pickInitialSemester([sem("A"), sem("B")], "GONE")).toBe("");
  });
  it("otherwise picks the only semester that has students", () => {
    expect(pickInitialSemester([sem("A")], null)).toBe("A");
    expect(pickInitialSemester([sem("EMPTY", { students: 0 }), sem("B")], null)).toBe("B");
  });
  it("leaves the choice to the user when it is not obvious", () => {
    expect(pickInitialSemester([sem("A"), sem("B")], null)).toBe("");
    expect(pickInitialSemester([sem("EMPTY", { students: 0 })], null)).toBe("");
    expect(pickInitialSemester([], null)).toBe("");
  });
});

describe("semesterProblems", () => {
  it("says nothing for a semester that is ready", () => {
    expect(semesterProblems(sem("A"))).toEqual([]);
  });
  it("names each thing that would make a run fail", () => {
    expect(semesterProblems(sem("A", { students: 0, courses: 0, preferenceLists: 0 }))).toEqual([
      "It has no active students.",
      "It has no active courses.",
      "No preference lists have been submitted yet.",
    ]);
    expect(semesterProblems(sem("A", { preferenceLists: 0 }))).toEqual(["No preference lists have been submitted yet."]);
  });
});

describe("remembering the last semester", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("round-trips through browser storage", () => {
    expect(readLastSemester()).toBeNull();
    rememberSemester("SEM-1");
    expect(readLastSemester()).toBe("SEM-1");
  });

  it("never breaks when storage is blocked (private windows)", () => {
    const blocked = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
    };
    vi.stubGlobal("localStorage", blocked);
    Object.defineProperty(window, "localStorage", { value: blocked, configurable: true });
    expect(() => rememberSemester("X")).not.toThrow();
    expect(readLastSemester()).toBeNull();
  });
});
