import { describe, expect, it } from "vitest";
import { DEFAULT_RUN_FORM, MAX_SEED, buildRunRequest, includesBaseline, includesOptimizer, pickRunningRun, usesBaselineSettings, validateRunForm } from "./runRequest.js";

const form = (patch = {}) => ({ ...DEFAULT_RUN_FORM, semesterId: " SEM-1 ", ...patch });

describe("validateRunForm", () => {
  it("accepts the defaults once a semester is entered", () => {
    expect(validateRunForm(form())).toEqual({});
  });

  it("requires a semester", () => {
    expect(validateRunForm(form({ semesterId: "   " })).semesterId).toBeTruthy();
  });

  it("limits courses per student to whole numbers 1 to 10", () => {
    for (const bad of [0, 11, 1.5, "abc", ""]) expect(validateRunForm(form({ maxCourses: bad })).maxCourses).toBeTruthy();
    for (const good of [1, 2, "3", 10]) expect(validateRunForm(form({ maxCourses: good })).maxCourses).toBeUndefined();
  });

  it("checks the seed only when it is entered and only when the baseline runs", () => {
    expect(validateRunForm(form({ seed: "" })).seed).toBeUndefined();
    expect(validateRunForm(form({ seed: "0" })).seed).toBeUndefined();
    expect(validateRunForm(form({ seed: String(MAX_SEED) })).seed).toBeUndefined();
    for (const bad of ["-1", "1.5", "abc", String(MAX_SEED + 1)]) expect(validateRunForm(form({ seed: bad })).seed).toBeTruthy();
    // an optimizer held to the baseline uses the seed too; an unconstrained one ignores it entirely
    expect(validateRunForm(form({ mode: "optimized", seed: "abc" })).seed).toBeTruthy();
    expect(validateRunForm(form({ mode: "optimized", protectBaseline: false, seed: "abc" })).seed).toBeUndefined();
  });

  it("checks the merit share", () => {
    expect(validateRunForm(form({ meritPercent: -5 })).meritPercent).toBeTruthy();
    expect(validateRunForm(form({ meritPercent: 105 })).meritPercent).toBeTruthy();
    expect(validateRunForm(form({ meritPercent: 0 })).meritPercent).toBeUndefined();
    expect(validateRunForm(form({ meritPercent: 100 })).meritPercent).toBeUndefined();
  });
});

describe("buildRunRequest", () => {
  it("compare: both algorithms, with the baseline's split and seed", () => {
    const { kind, body } = buildRunRequest(form({ seed: "42" }));
    expect(kind).toBe("compare");
    expect(body).toEqual({
      semesterId: "SEM-1", maxCoursesPerStudent: 2, includeTimetable: true, meritRatio: 0.7, randomRatio: 0.3, seed: 42,
      optimizerFloor: "baseline", cgpaPriority: true,
    });
  });

  it("omits the seed when it is empty (the server then draws a fresh lottery)", () => {
    expect(buildRunRequest(form({ seed: "  " })).body).not.toHaveProperty("seed");
  });

  it("baseline only: names the algorithm and keeps the baseline settings", () => {
    const { kind, body } = buildRunRequest(form({ mode: "baseline", meritPercent: 100, seed: "7", includeTimetable: false }));
    expect(kind).toBe("single");
    expect(body).toEqual({
      semesterId: "SEM-1", algorithm: "baseline", maxCoursesPerStudent: 2, includeTimetable: false, meritRatio: 1, randomRatio: 0, seed: 7,
    });
  });

  it("optimized only, held to the baseline (the default): sends the baseline's split and seed", () => {
    const { kind, body } = buildRunRequest(form({ mode: "optimized", meritPercent: 60, seed: "9" }));
    expect(kind).toBe("single");
    expect(body).toEqual({
      semesterId: "SEM-1", algorithm: "optimized", maxCoursesPerStudent: 2, includeTimetable: true,
      optimizerFloor: "baseline", cgpaPriority: true, meritRatio: 0.6, randomRatio: 0.4, seed: 9,
    });
  });

  it("optimized only, NOT held to the baseline: never sends a split or a seed (the API rejects them)", () => {
    const { body } = buildRunRequest(form({ mode: "optimized", protectBaseline: false, cgpaPriority: false, meritPercent: 60, seed: "9" }));
    expect(body).toEqual({
      semesterId: "SEM-1", algorithm: "optimized", maxCoursesPerStudent: 2, includeTimetable: true,
      optimizerFloor: "none", cgpaPriority: false,
    });
  });

  it("the baseline alone never sends optimizer settings", () => {
    const { body } = buildRunRequest(form({ mode: "baseline" }));
    expect(body).not.toHaveProperty("optimizerFloor");
    expect(body).not.toHaveProperty("cgpaPriority");
  });

  it("the optimizer is held to the baseline and uses CGPA unless the form says otherwise", () => {
    expect(DEFAULT_RUN_FORM).toMatchObject({ protectBaseline: true, cgpaPriority: true });
    expect(buildRunRequest(form({ protectBaseline: false })).body).toMatchObject({ optimizerFloor: "none" });
    expect(buildRunRequest(form({ cgpaPriority: false })).body).toMatchObject({ cgpaPriority: false });
  });

  it("when baseline settings are in play", () => {
    expect(usesBaselineSettings(form({ mode: "both" }))).toBe(true);
    expect(usesBaselineSettings(form({ mode: "baseline" }))).toBe(true);
    expect(usesBaselineSettings(form({ mode: "optimized" }))).toBe(true);
    expect(usesBaselineSettings(form({ mode: "optimized", protectBaseline: false }))).toBe(false);
  });

  it("the two ratios add up to 1 for every slider position (the API demands it)", () => {
    for (let merit = 0; merit <= 100; merit += 5) {
      const { body } = buildRunRequest(form({ meritPercent: merit }));
      expect(Math.abs(body.meritRatio + body.randomRatio - 1)).toBeLessThan(1e-9);
    }
  });

  it("which algorithms does a mode include", () => {
    expect([includesBaseline("both"), includesBaseline("baseline"), includesBaseline("optimized")]).toEqual([true, true, false]);
    expect([includesOptimizer("both"), includesOptimizer("baseline"), includesOptimizer("optimized")]).toEqual([true, false, true]);
  });
});

describe("pickRunningRun", () => {
  const runs = [
    { _id: "old", status: "running", semesterId: "S", createdAt: "2026-01-01T10:00:00Z" },
    { _id: "new", status: "running", semesterId: "S", createdAt: "2026-01-01T11:00:00Z" },
    { _id: "other", status: "running", semesterId: "T", createdAt: "2026-01-01T12:00:00Z" },
    { _id: "done", status: "completed", semesterId: "S", createdAt: "2026-01-01T13:00:00Z" },
  ];
  it("takes the newest running run of that semester", () => {
    expect(pickRunningRun(runs, "S")._id).toBe("new");
    expect(pickRunningRun(runs, "T")._id).toBe("other");
  });
  it("returns nothing when none is running", () => {
    expect(pickRunningRun(runs, "Z")).toBeUndefined();
    expect(pickRunningRun([], "S")).toBeUndefined();
    expect(pickRunningRun(undefined, "S")).toBeUndefined();
  });
});
