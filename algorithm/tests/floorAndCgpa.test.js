import { describe, it, expect } from "vitest";

import { runAllocation } from "../src/algorithms/allocationPipeline.js";
import { allocateOptimized } from "../src/algorithms/optimizedAllocation.js";
import { calculateMetrics } from "../src/evaluation/metrics.js";
import { validateAllocation } from "../src/validation/validateAllocation.js";
import { runAllocationComparison } from "../src/services/allocationComparisonService.js";
import { createSeededRandom } from "../src/utils/seededRandom.js";

const pref = (studentId, courseId, rank, electiveGroup) => ({ studentId, courseId, rank, electiveGroup });
const slotKey = (a) => `${a.studentId}|${a.electiveGroup}`;
const ranks = (allocs) => new Map(allocs.map((a) => [slotKey(a), a.preferenceRank]));
const cost = (allocs) => allocs.reduce((n, a) => n + a.preferenceRank - 1, 0);

/** A small open-elective instance: one shared pool, two independent lists per student. */
function instance(seed, { students: nStudents = 3, courses: nCourses = 4 } = {}) {
  const random = createSeededRandom(seed);
  const int = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));
  const students = Array.from({ length: nStudents }, (_, i) => ({ id: `S${i + 1}`, cgpa: Math.round((6 + random() * 4) * 100) / 100 }));
  const courses = Array.from({ length: nCourses }, (_, i) => ({ id: `C${i + 1}`, capacity: int(1, 2) }));
  const preferences = [];
  for (const s of students) {
    for (const group of ["OE1", "OE2"]) {
      const order = courses.map((c) => c.id).sort(() => random() - 0.5).slice(0, int(1, nCourses));
      order.forEach((courseId, i) => preferences.push(pref(s.id, courseId, i + 1, group)));
    }
  }
  return { students, courses, preferences };
}

const baselineOf = (input, seed) =>
  runAllocation(input, { meritRatio: 0.5, randomRatio: 0.5, random: createSeededRandom(seed) }).allocations;

describe("floor: nobody ends worse than the baseline", () => {
  it("keeps every student's result in every group as good or better, on 150 random instances", () => {
    let improved = 0;

    for (let seed = 1; seed <= 150; seed++) {
      const input = instance(seed, { students: 3 + (seed % 3), courses: 3 + (seed % 3) });
      const base = baselineOf(input, seed);
      const result = allocateOptimized(input, { maxCoursesPerStudent: 2, floor: base, cgpaPriority: true });
      const baseRank = ranks(base);
      const newRank = ranks(result.allocations);

      for (const [slot, rank] of baseRank) {
        // the slot is still filled, and with a course ranked at least as high
        expect(newRank.has(slot), `seed ${seed}: ${slot} lost`).toBe(true);
        expect(newRank.get(slot), `seed ${seed}: ${slot} worse`).toBeLessThanOrEqual(rank);
      }
      expect(result.allocations.length, `seed ${seed}`).toBeGreaterThanOrEqual(base.length);
      expect(cost(result.allocations), `seed ${seed}`).toBeLessThanOrEqual(cost(base));
      expect(result.assumptions.floorApplied).toBe(base.length > 0);
      if (cost(result.allocations) < cost(base) || result.allocations.length > base.length) improved++;
    }

    // the guarantee is not trivial: the optimizer really does improve on the baseline in a good share of them (small instances leave little room)
    expect(improved).toBeGreaterThan(10);
  });

  it("is exact: matches an exhaustive search over every allocation that respects the floor", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const input = instance(seed, { students: 2 + (seed % 2), courses: 3 + (seed % 2) });
      const base = baselineOf(input, seed);
      const result = allocateOptimized(input, { maxCoursesPerStudent: 2, floor: base });

      const floor = ranks(base);
      const allowed = input.preferences.filter((p) => {
        const f = floor.get(`${p.studentId}|${p.electiveGroup}`);
        return f === undefined || p.rank <= f;
      });

      let best = null;
      const left = new Map(input.courses.map((c) => [c.id, c.capacity]));
      const visit = (i, chosen) => {
        if (i === allowed.length) {
          // every slot the baseline filled must still be filled
          const filled = new Set(chosen.map((c) => `${c.studentId}|${c.electiveGroup}`));
          if (![...floor.keys()].every((slot) => filled.has(slot))) return;
          const flow = chosen.length;
          const total = chosen.reduce((n, c) => n + c.rank - 1, 0);
          if (!best || flow > best.flow || (flow === best.flow && total < best.cost)) best = { flow, cost: total };
          return;
        }
        visit(i + 1, chosen);
        const p = allowed[i];
        const mine = chosen.filter((c) => c.studentId === p.studentId);
        if (
          left.get(p.courseId) > 0 &&
          mine.length < 2 &&
          !mine.some((c) => c.electiveGroup === p.electiveGroup) &&
          !mine.some((c) => c.courseId === p.courseId)
        ) {
          left.set(p.courseId, left.get(p.courseId) - 1);
          visit(i + 1, [...chosen, p]);
          left.set(p.courseId, left.get(p.courseId) + 1);
        }
      };
      visit(0, []);

      expect({ flow: result.totalAllocated, cost: result.totalPreferenceCost }, `seed ${seed}`).toEqual(best);
    }
  });

  it("protects a high-CGPA student from being traded away for a lower total cost", () => {
    // C1 has one seat. H (CGPA 9) and L (CGPA 7) both rank it first. Without a floor the cheapest
    // total gives C1 to L (cost 0 + 1) instead of to H (cost 0 + 14). With the baseline floor, H keeps C1.
    const students = [{ id: "H", cgpa: 9 }, { id: "L", cgpa: 7 }];
    const courses = [{ id: "C1", capacity: 1 }, { id: "C2", capacity: 1 }];
    const list = (id, c2rank) => [pref(id, "C1", 1, "OE1"), pref(id, "C2", c2rank, "OE1")];
    const input = { students, courses, preferences: [...list("H", 2), ...list("L", 2)] };

    const base = runAllocation(input, { meritRatio: 1, randomRatio: 0 }).allocations;
    expect(base.find((a) => a.studentId === "H").courseId).toBe("C1");

    const floored = allocateOptimized(input, { maxCoursesPerStudent: 1, floor: base });
    expect(floored.allocations.find((a) => a.studentId === "H").courseId).toBe("C1");
  });

  it("the result is never worse than the floor even when the search is stopped at once", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const input = instance(seed, { students: 5, courses: 6 });
      const base = baselineOf(input, seed);
      const stopped = allocateOptimized(input, { maxCoursesPerStudent: 2, floor: base, maxWork: 1 });

      expect(stopped.allocations.length).toBeGreaterThanOrEqual(base.length);
      expect(cost(stopped.allocations)).toBeLessThanOrEqual(cost(base));
      const newRank = ranks(stopped.allocations);
      for (const [slot, rank] of ranks(base)) expect(newRank.get(slot)).toBeLessThanOrEqual(rank);
    }
  });

  it("is ignored when there are no elective groups, and says so", () => {
    const input = {
      students: [{ id: "S1", cgpa: 9 }],
      courses: [{ id: "C1", capacity: 1 }],
      preferences: [{ studentId: "S1", courseId: "C1", rank: 1 }],
    };
    const result = allocateOptimized(input, { floor: [{ studentId: "S1", courseId: "C1", preferenceRank: 1 }] });
    expect(result.assumptions.floorApplied).toBe(false);
    expect(result.allocations).toHaveLength(1);
  });

  it("is reproducible: the same baseline seed gives the same result", () => {
    const input = instance(7, { students: 5, courses: 6 });
    const a = allocateOptimized(input, { maxCoursesPerStudent: 2, floor: baselineOf(input, 3), cgpaPriority: true });
    const b = allocateOptimized(input, { maxCoursesPerStudent: 2, floor: baselineOf(input, 3), cgpaPriority: true });
    expect(a.allocations).toEqual(b.allocations);
  });
});

describe("CGPA priority inside the optimizer", () => {
  // Two students tie on total preference cost whichever of them gets C1 (one gets rank 1, the other rank 2).
  // Ids are chosen so that the plain tie-break (alphabetical) would favour the LOWER-CGPA student.
  const students = [{ id: "A", cgpa: 7 }, { id: "B", cgpa: 9 }];
  const courses = [{ id: "C1", capacity: 1 }, { id: "C2", capacity: 1 }];
  const list = (id) => [pref(id, "C1", 1, "OE1"), pref(id, "C2", 2, "OE1")];
  const input = { students, courses, preferences: [...list("A"), ...list("B")] };
  const courseOf = (r, id) => r.allocations.find((a) => a.studentId === id).courseId;

  it("without it, a tie goes by id; with it, the higher CGPA gets the better choice", () => {
    const plain = allocateOptimized(input, { maxCoursesPerStudent: 1 });
    expect(courseOf(plain, "A")).toBe("C1"); // arbitrary tie-break: the lower CGPA won

    const withCgpa = allocateOptimized(input, { maxCoursesPerStudent: 1, cgpaPriority: true });
    expect(courseOf(withCgpa, "B")).toBe("C1"); // CGPA 9 gets the first choice
    expect(courseOf(withCgpa, "A")).toBe("C2");
    expect(withCgpa.assumptions.cgpaPriority).toBe(true);
  });

  it("never trades total preference cost for CGPA: the reported cost is the plain cost", () => {
    const a = allocateOptimized(input, { maxCoursesPerStudent: 1 });
    const b = allocateOptimized(input, { maxCoursesPerStudent: 1, cgpaPriority: true });
    expect(b.totalPreferenceCost).toBe(a.totalPreferenceCost);
    expect(b.totalAllocated).toBe(a.totalAllocated);
  });

  it("cost still decides first: CGPA does not make a clearly worse total win", () => {
    // Giving C1 to the higher CGPA student costs 14 more than giving it to the other
    const lopsided = {
      students,
      courses,
      preferences: [
        pref("A", "C1", 1, "OE1"), pref("A", "C2", 2, "OE1"),
        pref("B", "C1", 1, "OE1"), pref("B", "C2", 15, "OE1"),
      ],
    };
    const r = allocateOptimized(lopsided, { maxCoursesPerStudent: 1, cgpaPriority: true });
    // B (CGPA 9) at C1 and A at C2 costs 1 + 0 = 1 ... A at C1 and B at C2 costs 0 + 14 = 14
    expect(courseOf(r, "B")).toBe("C1");
    expect(r.totalPreferenceCost).toBe(1);
  });

  it("works through the comparison service by default and is reported in the configuration", () => {
    const r = runAllocationComparison(instance(4, { students: 6, courses: 6 }), { seed: 2 });
    expect(r.configuration).toMatchObject({ optimizerFloor: "baseline", cgpaPriority: true });
    expect(r.optimized.assumptions).toMatchObject({ cgpaPriority: true });
  });
});

describe("the CGPA-priority check", () => {
  const students = [{ id: "H", cgpa: 9 }, { id: "L", cgpa: 7 }];
  const courses = [{ id: "C1", capacity: 1 }, { id: "C2", capacity: 1 }];
  const preferences = [
    pref("H", "C1", 1, "OE1"), pref("H", "C2", 2, "OE1"),
    pref("L", "C1", 1, "OE1"), pref("L", "C2", 2, "OE1"),
  ];
  const give = (course, id, rank) => ({ studentId: id, courseId: course, preferenceRank: rank, electiveGroup: "OE1" });
  const measure = (allocations, extra = {}) =>
    calculateMetrics({ students, courses, preferences, allocations, oneCoursePerGroup: true, ...extra }).cgpaPriorityViolations;

  it("is 0 when the higher CGPA got the course", () => {
    expect(measure([give("C1", "H", 1), give("C2", "L", 2)])).toBe(0);
  });

  it("counts a lower-CGPA student holding a course a higher-CGPA student wanted more", () => {
    expect(measure([give("C1", "L", 1), give("C2", "H", 2)])).toBe(1);
  });

  it("does not count it when the higher-CGPA student could not have taken the course (timetable clash)", () => {
    const timetable = {
      C1: [{ day: "Monday", start: "09:00", end: "09:50" }],
      C2: [{ day: "Monday", start: "09:00", end: "09:50" }],
    };
    // H holds C2 in the same slot as C1, but a student in ONE group slot would replace it, so use two groups:
    const twoGroups = {
      students, courses,
      preferences: [
        pref("H", "C1", 1, "OE1"), pref("H", "C2", 1, "OE2"),
        pref("L", "C1", 1, "OE1"),
      ],
    };
    const allocations = [
      { studentId: "L", courseId: "C1", preferenceRank: 1, electiveGroup: "OE1" },
      { studentId: "H", courseId: "C2", preferenceRank: 1, electiveGroup: "OE2" },
    ];
    // H ranked C1 first for OE1 and got nothing there; C1 went to L, but C1 overlaps H's C2
    expect(calculateMetrics({ ...twoGroups, allocations, oneCoursePerGroup: true }).cgpaPriorityViolations).toBe(1);
    expect(calculateMetrics({ ...twoGroups, allocations, oneCoursePerGroup: true, timetable }).cgpaPriorityViolations).toBe(0);
  });

  it("is 0 for a pure CGPA ranking (the merit seats of the baseline)", () => {
    const merit = runAllocation({ students, courses, preferences }, { meritRatio: 1, randomRatio: 0, maxCoursesPerStudent: 1 }).allocations;
    expect(measure(merit)).toBe(0);
    expect(validateAllocation({ students, courses, preferences, allocations: merit, oneCoursePerGroup: true }).valid).toBe(true);
  });
});
