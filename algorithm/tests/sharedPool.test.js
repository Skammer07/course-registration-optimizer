import { describe, it, expect } from "vitest";

import { allocateMeritPhase } from "../src/algorithms/baseline.js";
import { allocateRandomPhase } from "../src/algorithms/randomAllocation.js";
import { allocateOptimized } from "../src/algorithms/optimizedAllocation.js";
import { validateAllocation } from "../src/validation/validateAllocation.js";
import { calculateMetrics } from "../src/evaluation/metrics.js";
import { runAllocationComparison } from "../src/services/allocationComparisonService.js";
import { createSeededRandom } from "../src/utils/seededRandom.js";

// Open electives: ONE pool of courses with no group of their own. Every student
// has an independent priority list for OE1 and for OE2, drawn from that pool;
// the two lists may even be identical.
const pref = (studentId, courseId, rank, electiveGroup) => ({ studentId, courseId, rank, electiveGroup });
const listFor = (studentId, group, courseIds) => courseIds.map((c, i) => pref(studentId, c, i + 1, group));
const coursesHeld = (allocations, id) => allocations.filter((a) => a.studentId === id).map((a) => a.courseId).sort();
const groupsHeld = (allocations, id) => allocations.filter((a) => a.studentId === id).map((a) => a.electiveGroup).sort();

const pool = (n, capacity) => Array.from({ length: n }, (_, i) => ({ id: `C${i + 1}`, capacity }));

describe("optimizer: two groups drawing from one pool", () => {
  it("gives a student a different course for each group even when both lists are identical", () => {
    const result = allocateOptimized(
      {
        students: [{ id: "S1", cgpa: 9 }],
        courses: pool(3, 5),
        preferences: [...listFor("S1", "OE1", ["C1", "C2", "C3"]), ...listFor("S1", "OE2", ["C1", "C2", "C3"])],
      },
      { maxCoursesPerStudent: 2 }
    );

    expect(result.allocations).toHaveLength(2);
    expect(new Set(coursesHeld(result.allocations, "S1")).size).toBe(2); // never the same course twice
    expect(groupsHeld(result.allocations, "S1")).toEqual(["OE1", "OE2"]);
    // best possible: the two top courses, one for each group
    expect(result.totalPreferenceCost).toBe(1);
  });

  it("each list is scored on its own: a course can be rank 1 in one group and rank 3 in the other", () => {
    const result = allocateOptimized(
      {
        students: [{ id: "S1", cgpa: 9 }],
        courses: pool(3, 5),
        preferences: [...listFor("S1", "OE1", ["C1", "C2", "C3"]), ...listFor("S1", "OE2", ["C3", "C2", "C1"])],
      },
      { maxCoursesPerStudent: 2 }
    );

    const byGroup = Object.fromEntries(result.allocations.map((a) => [a.electiveGroup, a]));
    expect(byGroup.OE1).toMatchObject({ courseId: "C1", preferenceRank: 1 });
    expect(byGroup.OE2).toMatchObject({ courseId: "C3", preferenceRank: 1 });
    expect(result.totalPreferenceCost).toBe(0);
  });

  it("seats are shared by both groups: one seat serves one student once", () => {
    const result = allocateOptimized(
      {
        students: [{ id: "S1", cgpa: 9 }, { id: "S2", cgpa: 8 }],
        courses: [{ id: "C1", capacity: 1 }, { id: "C2", capacity: 1 }],
        preferences: [
          ...listFor("S1", "OE1", ["C1", "C2"]), ...listFor("S1", "OE2", ["C1", "C2"]),
          ...listFor("S2", "OE1", ["C1", "C2"]), ...listFor("S2", "OE2", ["C1", "C2"]),
        ],
      },
      { maxCoursesPerStudent: 2 }
    );

    // two seats in total, two assignments; nobody is given a course twice
    expect(result.allocations).toHaveLength(2);
    for (const id of ["S1", "S2"]) expect(new Set(coursesHeld(result.allocations, id)).size).toBe(coursesHeld(result.allocations, id).length);
  });

  it("is exact: matches an exhaustive search on 120 small random instances with overlapping lists", () => {
    for (let seed = 1; seed <= 120; seed++) {
      const random = createSeededRandom(seed);
      const int = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));

      const students = Array.from({ length: int(2, 3) }, (_, i) => ({ id: `S${i + 1}`, cgpa: 6 + random() * 4 }));
      const cs = pool(int(2, 4), 1).map((c) => ({ ...c, capacity: int(1, 2) }));
      const prefs = [];
      for (const s of students) {
        for (const group of ["OE1", "OE2"]) {
          const order = cs.map((c) => c.id).sort(() => random() - 0.5).slice(0, int(1, cs.length));
          order.forEach((courseId, i) => prefs.push(pref(s.id, courseId, i + 1, group)));
        }
      }

      const result = allocateOptimized({ students, courses: cs, preferences: prefs }, { maxCoursesPerStudent: 2 });

      let best = null;
      const left = new Map(cs.map((c) => [c.id, c.capacity]));
      const visit = (i, chosen) => {
        if (i === prefs.length) {
          const flow = chosen.length;
          const cost = chosen.reduce((sum, p) => sum + p.rank - 1, 0);
          if (!best || flow > best.flow || (flow === best.flow && cost < best.cost)) best = { flow, cost };
          return;
        }
        visit(i + 1, chosen);
        const p = prefs[i];
        const mine = chosen.filter((c) => c.studentId === p.studentId);
        if (
          left.get(p.courseId) > 0 &&
          mine.length < 2 &&
          !mine.some((c) => c.electiveGroup === p.electiveGroup) && // one per group
          !mine.some((c) => c.courseId === p.courseId) // never the same course twice
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

  it("respects timetable clashes and compulsory slots across the shared pool", () => {
    const timetable = {
      C1: [{ day: "Monday", start: "09:00", end: "09:50" }],
      C2: [{ day: "Monday", start: "09:00", end: "09:50" }], // clashes with C1
      C3: [{ day: "Tuesday", start: "09:00", end: "09:50" }],
    };
    const result = allocateOptimized(
      {
        students: [{ id: "S1", cgpa: 9 }],
        courses: pool(3, 5),
        preferences: [...listFor("S1", "OE1", ["C1", "C2", "C3"]), ...listFor("S1", "OE2", ["C2", "C1", "C3"])],
      },
      { maxCoursesPerStudent: 2, timetable }
    );

    const held = coursesHeld(result.allocations, "S1");
    expect(held).toHaveLength(2);
    expect(held).not.toEqual(["C1", "C2"]); // they overlap
    expect(held).toContain("C3");
  });
});

describe("baseline: students in CGPA order across the shared pool", () => {
  const students = [{ id: "H", cgpa: 9 }, { id: "M", cgpa: 8 }, { id: "L", cgpa: 7 }];
  const courses = [{ id: "C1", capacity: 1 }, { id: "C2", capacity: 1 }, { id: "C3", capacity: 3 }];
  const preferences = students.flatMap((s) => [
    ...listFor(s.id, "OE1", ["C1", "C2", "C3"]),
    ...listFor(s.id, "OE2", ["C1", "C2", "C3"]),
  ]);

  it("the highest CGPA gets the best course for each group, never the same course twice", () => {
    const r = allocateMeritPhase({ students, courses, preferences }, { meritRatio: 1 });

    const high = r.allocations.filter((a) => a.studentId === "H");
    expect(high.map((a) => a.courseId).sort()).toEqual(["C1", "C2"]);
    expect(high.find((a) => a.electiveGroup === "OE1").courseId).toBe("C1");
    expect(high.find((a) => a.electiveGroup === "OE2").courseId).toBe("C2"); // C1 already held
    expect(r.assumptions.oneCoursePerGroup).toBe(true);
  });

  it("lower CGPA students take what the higher ones left", () => {
    const r = allocateMeritPhase({ students, courses, preferences }, { meritRatio: 1 });
    expect(coursesHeld(r.allocations, "M")).toEqual(["C3"]); // C1, C2 are gone; C3 only once
    expect(coursesHeld(r.allocations, "L")).toEqual(["C3"]);
  });

  it("lottery phase also gives one course per group and never repeats a course", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = allocateRandomPhase(
        { students, courses: pool(4, 4), preferences: students.flatMap((s) => [...listFor(s.id, "OE1", ["C1", "C2", "C3", "C4"]), ...listFor(s.id, "OE2", ["C1", "C2", "C3", "C4"])]), existingAllocations: [] },
        { randomRatio: 1, random: createSeededRandom(seed) }
      );

      for (const s of students) {
        const mine = r.allocations.filter((a) => a.studentId === s.id);
        expect(new Set(mine.map((a) => a.courseId)).size).toBe(mine.length);
        expect(new Set(mine.map((a) => a.electiveGroup)).size).toBe(mine.length);
      }
    }
  });
});

describe("validator and metrics with shared pool", () => {
  const students = [{ id: "S1", cgpa: 9 }];
  const courses = pool(3, 5);
  const preferences = [...listFor("S1", "OE1", ["C1", "C2", "C3"]), ...listFor("S1", "OE2", ["C3", "C2", "C1"])];

  it("accepts one course per group from each group's own list", () => {
    const allocations = [
      { studentId: "S1", courseId: "C1", preferenceRank: 1, electiveGroup: "OE1" },
      { studentId: "S1", courseId: "C3", preferenceRank: 1, electiveGroup: "OE2" },
    ];
    expect(validateAllocation({ students, courses, preferences, allocations, oneCoursePerGroup: true }).valid).toBe(true);
    const m = calculateMetrics({ students, courses, preferences, allocations, oneCoursePerGroup: true });
    expect(m.rank1Assignments).toBe(2);
    expect(m.studentsMissingAGroup).toBe(0);
    expect(m.groupLimitViolations).toBe(0);
  });

  it("rejects the same course twice, and two courses in one group", () => {
    const twice = [
      { studentId: "S1", courseId: "C1", preferenceRank: 1, electiveGroup: "OE1" },
      { studentId: "S1", courseId: "C1", preferenceRank: 3, electiveGroup: "OE2" },
    ];
    expect(validateAllocation({ students, courses, preferences, allocations: twice, oneCoursePerGroup: true }).errors.join(" ")).toMatch(/duplicate/);

    const sameGroup = [
      { studentId: "S1", courseId: "C1", preferenceRank: 1, electiveGroup: "OE1" },
      { studentId: "S1", courseId: "C2", preferenceRank: 2, electiveGroup: "OE1" },
    ];
    expect(validateAllocation({ students, courses, preferences, allocations: sameGroup, oneCoursePerGroup: true }).errors.join(" ")).toMatch(/elective group "OE1"/);
  });

  it("rejects a course that is not in the list of the group it was given for", () => {
    const wrong = [{ studentId: "S1", courseId: "C1", preferenceRank: 1, electiveGroup: "OE3" }];
    expect(validateAllocation({ students, courses, preferences, allocations: wrong, oneCoursePerGroup: true }).valid).toBe(false);
  });
});

describe("services with the shared pool", () => {
  it("both algorithms return valid results with one course per group and no repeats", () => {
    const students = Array.from({ length: 20 }, (_, i) => ({ id: `S${i + 1}`, cgpa: 9.5 - i * 0.1 }));
    const courses = pool(8, 5);
    const preferences = students.flatMap((s) => {
      const order = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"];
      return [...listFor(s.id, "OE1", order), ...listFor(s.id, "OE2", order)];
    });

    const r = runAllocationComparison({ students, courses, preferences }, { seed: 4 });

    for (const side of [r.baseline, r.optimized]) {
      expect(side.validation.valid).toBe(true);
      expect(side.metrics.groupLimitViolations).toBe(0);
      expect(side.metrics.duplicateAssignments).toBe(0);
      for (const s of students) {
        const mine = side.allocations.filter((a) => a.studentId === s.id);
        expect(new Set(mine.map((a) => a.courseId)).size).toBe(mine.length);
      }
    }
    // 8 courses x 5 seats = 40 seats for 40 slots: the optimizer fills every slot
    expect(r.optimized.metrics.totalAssignments).toBe(40);
    expect(r.optimized.metrics.studentsMissingAGroup).toBe(0);
  });
});
