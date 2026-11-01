import { describe, it, expect } from "vitest";
import { allocateMeritPhase } from "../src/algorithms/baseline.js";
import {
  runAllocationComparison,
  ALGORITHM_VERSION,
} from "../src/services/allocationComparisonService.js";
import { createSeededRandom } from "../src/utils/seededRandom.js";

const students = ["S1", "S2", "S3", "S4", "S5", "S6"].map((id, i) => ({
  id,
  name: id,
  cgpa: 9 - i * 0.3,
}));
const courses = [
  { id: "C1", name: "C1", capacity: 4, electiveGroup: "A" },
  { id: "C2", name: "C2", capacity: 4, electiveGroup: "A" },
];
const preferences = students.flatMap((s) => [
  { studentId: s.id, courseId: "C1", rank: 1, electiveGroup: "A" },
  { studentId: s.id, courseId: "C2", rank: 2, electiveGroup: "A" },
]);
const input = { students, courses, preferences };

describe("meritRatio / randomRatio boundaries", () => {
  it("meritRatio 0 allocates nothing in the merit phase (no throw)", () => {
    const r = allocateMeritPhase(input, { meritRatio: 0 });
    expect(r.allocations).toHaveLength(0);
  });

  it("meritRatio 0 / randomRatio 1 is a valid end-to-end configuration", () => {
    const r = runAllocationComparison(input, { meritRatio: 0, randomRatio: 1, seed: 7 });
    expect(r.baseline.validation.valid).toBe(true);
    expect(r.baseline.allocations.length).toBeGreaterThan(0);
    expect(r.baseline.allocations.every((a) => a.phase === "random")).toBe(true);
  });

  it("meritRatio 1 / randomRatio 0 is valid and uses only the merit phase", () => {
    const r = runAllocationComparison(input, { meritRatio: 1, randomRatio: 0, seed: 7 });
    expect(r.baseline.validation.valid).toBe(true);
    expect(r.baseline.allocations.length).toBeGreaterThan(0);
    expect(r.baseline.allocations.every((a) => a.phase === "merit")).toBe(true);
  });

  it("a mixed ratio keeps working and stays valid", () => {
    const r = runAllocationComparison(input, { meritRatio: 0.5, randomRatio: 0.5, seed: 3 });
    expect(r.baseline.validation.valid).toBe(true);
    expect(r.configuration.meritRatio).toBe(0.5);
  });

  it.each([
    [-0.1, 1.1],
    [1.5, -0.5],
    [NaN, 1],
    [0.5, Infinity],
    [Infinity, -Infinity],
    [0.5, 0.4],
    [0.9, 0.9],
  ])("rejects invalid ratios %s / %s", (m, r) => {
    expect(() => runAllocationComparison(input, { meritRatio: m, randomRatio: r })).toThrow();
  });

  it("baseline merit phase rejects negative / >1 / non-finite meritRatio", () => {
    for (const bad of [-0.01, 1.01, NaN, Infinity]) {
      expect(() => allocateMeritPhase(input, { meritRatio: bad })).toThrow(/meritRatio/);
    }
  });
});

describe("seeded randomness and reproducibility", () => {
  it("createSeededRandom is deterministic and within [0,1)", () => {
    const seqA = Array.from({ length: 50 }, createSeededRandom(42));
    expect(seqA).toEqual(Array.from({ length: 50 }, createSeededRandom(42)));
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(Array.from({ length: 5 }, createSeededRandom(43))).not.toEqual(seqA.slice(0, 5));
  });

  it("rejects an invalid seed", () => {
    for (const bad of [-1, 1.5, NaN, 2 ** 32]) {
      expect(() => createSeededRandom(bad)).toThrow();
    }
  });

  it("same snapshot + version + seed reproduces the same baseline result", () => {
    const opts = { meritRatio: 0.25, randomRatio: 0.75, seed: 12345 };
    const a = runAllocationComparison(structuredClone(input), opts);
    const b = runAllocationComparison(structuredClone(input), opts);
    expect(a.baseline.allocations).toEqual(b.baseline.allocations);
    expect(a.configuration.randomSeed).toBe(12345);
    expect(a.configuration.algorithmVersion).toBe(ALGORITHM_VERSION);
  });

  it("different seeds vary the lottery; a seed is generated and reported when omitted", () => {
    const opts = { meritRatio: 0, randomRatio: 1 };
    const seen = new Set();
    for (let seed = 1; seed <= 20; seed++) {
      seen.add(
        JSON.stringify(
          runAllocationComparison(structuredClone(input), { ...opts, seed }).baseline.allocations
        )
      );
    }
    expect(seen.size).toBeGreaterThan(1);
    const auto = runAllocationComparison(structuredClone(input), opts);
    expect(Number.isInteger(auto.configuration.randomSeed)).toBe(true);
  });

  it("an explicit random function still takes precedence (existing behavior)", () => {
    const r = runAllocationComparison(structuredClone(input), { random: () => 0.5 });
    expect(r.configuration.randomSeed).toBeNull();
  });
});

describe("elective group identity does not disturb the algorithms when groups are not enforced", () => {
  it("group-tagged records give the same result as untagged ones", () => {
    const stripped = {
      students,
      courses: courses.map(({ electiveGroup: _g, ...c }) => c),
      preferences: preferences.map(({ electiveGroup: _g, ...p }) => p),
    };
    const off = { seed: 99, oneCoursePerGroup: false };
    const a = runAllocationComparison(structuredClone(input), off);
    const b = runAllocationComparison(stripped, off);
    expect(a.baseline.allocations).toEqual(b.baseline.allocations);
    expect(a.optimized.allocations).toEqual(b.optimized.allocations);
  });
});
