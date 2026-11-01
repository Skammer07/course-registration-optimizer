import { describe, it, expect } from "vitest";

import { allocateMeritPhase } from "../src/algorithms/baseline.js";
import { allocateRandomPhase } from "../src/algorithms/randomAllocation.js";
import { runAllocation } from "../src/algorithms/allocationPipeline.js";
import { allocateOptimized } from "../src/algorithms/optimizedAllocation.js";
import { validateAllocation } from "../src/validation/validateAllocation.js";
import { calculateMetrics } from "../src/evaluation/metrics.js";
import { runSingleAllocation } from "../src/services/singleAllocationService.js";
import { runAllocationComparison } from "../src/services/allocationComparisonService.js";
import { createSeededRandom } from "../src/utils/seededRandom.js";

const pref = (studentId, courseId, rank) => ({ studentId, courseId, rank });
const heldBy = (allocations, id) => allocations.filter((a) => a.studentId === id).map((a) => a.courseId).sort();
const groupsHeld = (allocations, id, groupOf) =>
  allocations.filter((a) => a.studentId === id).map((a) => groupOf[a.courseId]).sort();

// Two groups with independent priority lists: A courses and B courses.
const courses = [
  { id: "A1", capacity: 2, electiveGroup: "A" },
  { id: "A2", capacity: 2, electiveGroup: "A" },
  { id: "B1", capacity: 2, electiveGroup: "B" },
  { id: "B2", capacity: 2, electiveGroup: "B" },
];
const groupOf = { A1: "A", A2: "A", B1: "B", B2: "B" };

describe("optimizer: one course per elective group", () => {
  it("never gives two courses of the same group, even when both are free and wanted", () => {
    const result = allocateOptimized(
      {
        students: [{ id: "S1", cgpa: 9 }],
        courses,
        // the student wants both A courses first, and B only as a lower choice
        preferences: [pref("S1", "A1", 1), pref("S1", "A2", 2), pref("S1", "B1", 3)],
      },
      { maxCoursesPerStudent: 2 }
    );

    expect(groupsHeld(result.allocations, "S1", groupOf)).toEqual(["A", "B"]);
    expect(result.assumptions.oneCoursePerGroup).toBe(true);
  });

  it("gives every student a course from each group that has a seat for them", () => {
    const students = ["S1", "S2", "S3", "S4"].map((id, i) => ({ id, cgpa: 9 - i }));
    const preferences = students.flatMap((s) => [
      pref(s.id, "A1", 1), pref(s.id, "A2", 2), pref(s.id, "B1", 1), pref(s.id, "B2", 2),
    ]);
    const result = allocateOptimized({ students, courses, preferences }, { maxCoursesPerStudent: 2 });

    for (const s of students) expect(groupsHeld(result.allocations, s.id, groupOf)).toEqual(["A", "B"]);
    expect(result.totalAllocated).toBe(8);
  });

  it("the two lists are independent: a full course in one group does not cost a seat in the other", () => {
    const result = allocateOptimized(
      {
        students: [{ id: "S1", cgpa: 9 }, { id: "S2", cgpa: 8 }, { id: "S3", cgpa: 7 }],
        courses: [
          { id: "A1", capacity: 1, electiveGroup: "A" },
          { id: "B1", capacity: 3, electiveGroup: "B" },
        ],
        preferences: [
          pref("S1", "A1", 1), pref("S2", "A1", 1), pref("S3", "A1", 1),
          pref("S1", "B1", 1), pref("S2", "B1", 1), pref("S3", "B1", 1),
        ],
      },
      { maxCoursesPerStudent: 2 }
    );

    // only one student can have A1, but all three get B1
    expect(result.allocations.filter((a) => a.courseId === "A1")).toHaveLength(1);
    expect(result.allocations.filter((a) => a.courseId === "B1")).toHaveLength(3);
  });

  it("courses without a group are not limited", () => {
    const result = allocateOptimized(
      {
        students: [{ id: "S1", cgpa: 9 }],
        courses: [{ id: "X1", capacity: 1 }, { id: "X2", capacity: 1 }],
        preferences: [pref("S1", "X1", 1), pref("S1", "X2", 2)],
      },
      { maxCoursesPerStudent: 2 }
    );
    expect(heldBy(result.allocations, "S1")).toEqual(["X1", "X2"]);
  });

  it("can be switched off, restoring the old total-only limit", () => {
    const result = allocateOptimized(
      { students: [{ id: "S1", cgpa: 9 }], courses, preferences: [pref("S1", "A1", 1), pref("S1", "A2", 2)] },
      { maxCoursesPerStudent: 2, oneCoursePerGroup: false }
    );
    expect(heldBy(result.allocations, "S1")).toEqual(["A1", "A2"]);
  });

  it("is exact: matches an exhaustive search on 120 small random grouped instances", () => {
    for (let seed = 1; seed <= 120; seed++) {
      const random = createSeededRandom(seed);
      const int = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));

      const students = Array.from({ length: int(2, 4) }, (_, i) => ({ id: `S${i + 1}`, cgpa: 6 + random() * 4 }));
      const cs = Array.from({ length: int(3, 5) }, (_, i) => ({
        id: `C${i + 1}`, capacity: int(1, 2), electiveGroup: i % 2 === 0 ? "A" : "B",
      }));
      const prefs = [];
      for (const s of students) {
        const order = cs.map((c) => c.id).sort(() => random() - 0.5).slice(0, int(1, cs.length));
        order.forEach((courseId, i) => prefs.push(pref(s.id, courseId, i + 1)));
      }

      const result = allocateOptimized({ students, courses: cs, preferences: prefs }, { maxCoursesPerStudent: 2 });

      // exhaustive: most assignments, then lowest cost, one per group, capacities
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
        const group = cs.find((c) => c.id === p.courseId).electiveGroup;
        const mine = chosen.filter((c) => c.studentId === p.studentId);
        if (
          left.get(p.courseId) > 0 &&
          mine.length < 2 &&
          !mine.some((c) => cs.find((x) => x.id === c.courseId).electiveGroup === group)
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
});

describe("baseline: merit rounds per group", () => {
  it("serves each group in CGPA order with that group's own list", () => {
    // B1 has one seat. The high-CGPA student must get it even though their
    // first pick in group A was handled first.
    const input = {
      students: [{ id: "H", cgpa: 9 }, { id: "L", cgpa: 7 }],
      courses: [
        { id: "A1", capacity: 5, electiveGroup: "A" },
        { id: "B1", capacity: 1, electiveGroup: "B" },
      ],
      preferences: [pref("H", "A1", 1), pref("H", "B1", 1), pref("L", "B1", 1)],
    };

    const result = allocateMeritPhase(input, { meritRatio: 1 });

    expect(heldBy(result.allocations, "H")).toEqual(["A1", "B1"]);
    expect(heldBy(result.allocations, "L")).toEqual([]);
    expect(result.assumptions.oneCoursePerGroup).toBe(true);
    expect(result.assumptions.meritIterations).toBe(2); // one round per group
  });

  it("never gives a student two courses of one group", () => {
    const result = allocateMeritPhase(
      {
        students: [{ id: "S1", cgpa: 9 }],
        courses,
        preferences: [pref("S1", "A1", 1), pref("S1", "A2", 2), pref("S1", "B1", 3)],
      },
      { meritRatio: 1 }
    );
    expect(groupsHeld(result.allocations, "S1", groupOf)).toEqual(["A", "B"]);
  });

  it("keeps the original two iterations when there are no groups", () => {
    const result = allocateMeritPhase(
      {
        students: [{ id: "S1", cgpa: 9 }],
        courses: [{ id: "X1", capacity: 4 }, { id: "X2", capacity: 4 }],
        preferences: [pref("S1", "X1", 1), pref("S1", "X2", 2)],
      },
      { meritRatio: 1 }
    );
    expect(heldBy(result.allocations, "S1")).toEqual(["X1", "X2"]);
    expect(result.assumptions.meritIterations).toBe(2);
  });
});

describe("lottery phase: one course per group, best-ranked first", () => {
  const students = [{ id: "S1", cgpa: 9 }, { id: "S2", cgpa: 8 }];
  const cs = [
    { id: "B1", capacity: 1, electiveGroup: "B" },
    { id: "B2", capacity: 1, electiveGroup: "B" },
  ];
  const prefs = students.flatMap((s) => [pref(s.id, "B1", 1), pref(s.id, "B2", 2)]);

  it("each student gets one course of the group, and nobody gets a low choice while a better one is free", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = allocateRandomPhase(
        { students, courses: cs, preferences: prefs, existingAllocations: [] },
        { randomRatio: 1, random: createSeededRandom(seed) }
      );

      expect(r.allocations).toHaveLength(2);
      for (const s of students) expect(heldBy(r.allocations, s.id)).toHaveLength(1);
      // the winner of B1 had it as first choice; the other one takes B2
      expect(r.allocations.map((a) => a.preferenceRank).sort()).toEqual([1, 2]);
    }
  });

  it("skips students who already hold a course of that group from the merit phase", () => {
    const r = allocateRandomPhase(
      {
        students,
        courses: cs,
        preferences: prefs,
        existingAllocations: [{ studentId: "S1", courseId: "B1", preferenceRank: 1, phase: "merit" }],
      },
      { randomRatio: 1, random: () => 0.5 }
    );

    expect(r.allocations.every((a) => a.studentId !== "S1")).toBe(true);
  });
});

describe("validator and metrics", () => {
  const input = {
    students: [{ id: "S1", cgpa: 9 }],
    courses,
    preferences: [pref("S1", "A1", 1), pref("S1", "A2", 2), pref("S1", "B1", 3)],
  };
  const twoInA = [
    { studentId: "S1", courseId: "A1", preferenceRank: 1 },
    { studentId: "S1", courseId: "A2", preferenceRank: 2 },
  ];

  it("rejects two courses in one group when the rule is on, and accepts them when it is off", () => {
    const on = validateAllocation({ ...input, allocations: twoInA, oneCoursePerGroup: true });
    expect(on.valid).toBe(false);
    expect(on.errors.join(" ")).toMatch(/elective group "A"/);
    expect(validateAllocation({ ...input, allocations: twoInA }).valid).toBe(true);
  });

  it("counts group violations and students missing a group", () => {
    const m = calculateMetrics({ ...input, allocations: twoInA, oneCoursePerGroup: true });
    expect(m.groupLimitViolations).toBe(1);
    expect(m.studentsMissingAGroup).toBe(1); // ranked B1 but got no B course
    expect(m.constraintViolations).toBe(1);

    const ok = calculateMetrics({
      ...input,
      allocations: [
        { studentId: "S1", courseId: "A1", preferenceRank: 1 },
        { studentId: "S1", courseId: "B1", preferenceRank: 3 },
      ],
      oneCoursePerGroup: true,
    });
    expect(ok.groupLimitViolations).toBe(0);
    expect(ok.studentsMissingAGroup).toBe(0);
  });

  it("both algorithms always satisfy the rule through the services", () => {
    const students = Array.from({ length: 12 }, (_, i) => ({ id: `S${i + 1}`, cgpa: 9 - i * 0.2 }));
    const preferences = students.flatMap((s) => [
      pref(s.id, "A1", 1), pref(s.id, "A2", 2), pref(s.id, "B2", 1), pref(s.id, "B1", 2),
    ]);

    const both = runAllocationComparison({ students, courses, preferences }, { seed: 3 });
    expect(both.configuration.oneCoursePerGroup).toBe(true);
    expect(both.baseline.metrics.groupLimitViolations).toBe(0);
    expect(both.optimized.metrics.groupLimitViolations).toBe(0);
    expect(both.optimized.validation.valid).toBe(true);

    const single = runSingleAllocation({ students, courses, preferences }, { algorithm: "baseline", seed: 3 });
    expect(single.metrics.groupLimitViolations).toBe(0);
  });
});

describe("70/30 default", () => {
  it("the default split is 70% merit and 30% lottery", () => {
    const r = runAllocationComparison(
      { students: [{ id: "S1", cgpa: 9 }], courses: [{ id: "C1", capacity: 10 }], preferences: [pref("S1", "C1", 1)] },
      { seed: 1 }
    );
    expect(r.configuration.meritRatio).toBe(0.7);
    expect(r.configuration.randomRatio).toBe(0.3);

    const merit = allocateMeritPhase(
      { students: [{ id: "S1", cgpa: 9 }], courses: [{ id: "C1", capacity: 10 }], preferences: [pref("S1", "C1", 1)] }
    );
    expect(merit.courseSummary[0].meritQuota).toBe(7);
  });

  it("no seat is lost to rounding: merit and lottery quotas always add up to the capacity", () => {
    for (let capacity = 0; capacity <= 60; capacity++) {
      const data = { students: [{ id: "S1", cgpa: 9 }], courses: [{ id: "C1", capacity }], preferences: [] };
      const merit = allocateMeritPhase(data).courseSummary[0].meritQuota;
      const lottery = allocateRandomPhase({ ...data, existingAllocations: [] }).courseSummary[0].randomQuota;
      expect(merit + lottery, `capacity ${capacity}`).toBe(capacity);
    }
  });

  it("a full pipeline still fills every seat it can", () => {
    const students = Array.from({ length: 5 }, (_, i) => ({ id: `S${i + 1}`, cgpa: 9 - i }));
    const r = runAllocation(
      { students, courses: [{ id: "C1", capacity: 5 }], preferences: students.map((s) => pref(s.id, "C1", 1)) },
      { random: () => 0.5 }
    );
    expect(r.allocations).toHaveLength(5);
  });
});
