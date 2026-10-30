import { describe, it, expect } from "vitest";
import { runSingleAllocation } from "../src/services/singleAllocationService.js";
import { runAllocationComparison } from "../src/services/allocationComparisonService.js";

const students = ["S1", "S2", "S3", "S4"].map((id, i) => ({ id, name: id, cgpa: 9 - i * 0.5 }));
const courses = [
  { id: "C1", name: "C1", capacity: 2 },
  { id: "C2", name: "C2", capacity: 2 },
];
const preferences = students.flatMap((s) => [
  { studentId: s.id, courseId: "C1", rank: 1 },
  { studentId: s.id, courseId: "C2", rank: 2 },
]);
const input = { students, courses, preferences };

describe("runSingleAllocation", () => {
  it("runs only the baseline and matches the baseline side of the combined run", () => {
    const single = runSingleAllocation(structuredClone(input), { algorithm: "baseline", seed: 5 });
    const both = runAllocationComparison(structuredClone(input), { seed: 5 });
    expect(single.algorithm).toBe("baseline");
    expect(single.allocations).toEqual(both.baseline.allocations);
    expect(single.metrics).toEqual(both.baseline.metrics);
    expect(single.validation.valid).toBe(true);
    expect(single.configuration.randomSeed).toBe(5);
    expect(single.optimized).toBeUndefined();
  });

  it("runs only the optimizer and matches the optimized side of the combined run", () => {
    const single = runSingleAllocation(structuredClone(input), { algorithm: "optimized" });
    const both = runAllocationComparison(structuredClone(input), { seed: 5 });
    expect(single.allocations).toEqual(both.optimized.allocations);
    expect(single.metrics).toEqual(both.optimized.metrics);
    expect(single.configuration.meritRatio).toBeNull();
    expect(single.configuration.randomSeed).toBeNull();
  });

  it("reports the policy details (phase split / assumptions / no-quota flag)", () => {
    const base = runSingleAllocation(structuredClone(input), { algorithm: "baseline", seed: 5 });
    const both = runAllocationComparison(structuredClone(input), { seed: 5 });
    expect(base.phaseSummary).toEqual(both.baseline.phaseSummary);
    expect(base.assumptions).toEqual(both.baseline.assumptions);
    expect(base.assumptions.join(" ")).toMatch(/Unused merit quota does not transfer/);

    const opt = runSingleAllocation(structuredClone(input), { algorithm: "optimized" });
    expect(opt.assumptions.meritRandomQuotasPreserved).toBe(false);
    expect(opt.totalPreferenceCost).toBe(both.optimized.totalPreferenceCost);
    expect(opt.phaseSummary).toBeNull();
  });

  it("baseline supports meritRatio 0 and 1", () => {
    for (const [m, r] of [[0, 1], [1, 0]]) {
      const res = runSingleAllocation(structuredClone(input), {
        algorithm: "baseline", meritRatio: m, randomRatio: r, seed: 1,
      });
      expect(res.validation.valid).toBe(true);
    }
  });

  it.each([
    [{ algorithm: "both" }],
    [{}],
    [{ algorithm: "baseline", meritRatio: 0.5, randomRatio: 0.4 }],
    [{ algorithm: "baseline", meritRatio: NaN, randomRatio: 1 }],
    [{ algorithm: "optimized", maxCoursesPerStudent: 0 }],
  ])("rejects invalid options %j", (opts) => {
    expect(() => runSingleAllocation(structuredClone(input), opts)).toThrow();
  });

  it("rejects malformed input", () => {
    expect(() => runSingleAllocation(null, { algorithm: "baseline" })).toThrow();
    expect(() => runSingleAllocation({ students }, { algorithm: "optimized" })).toThrow();
  });
});
