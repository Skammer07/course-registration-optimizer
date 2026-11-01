/**
 * tests/unit/floorBackend.test.js
 * The optimizer held to the baseline's result: the settings are validated and stored, the new metrics
 * survive being saved, and the per-student evidence compares the two algorithms.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

let allocationRows = [];
let snapshotStudents = [];

vi.mock("../../src/models/Allocation.js", () => ({
  default: {
    find: () => ({ select: () => ({ populate: () => ({ lean: async () => allocationRows }) }) }),
  },
}));
vi.mock("../../src/models/AllocationRun.js", async (importOriginal) => {
  const original = await importOriginal();
  return {
    default: Object.assign(original.default, {
      findById: () => ({ select: () => ({ lean: async () => ({ inputSnapshot: { students: snapshotStudents } }) }) }),
    }),
  };
});

const { comparisonEvidence } = await import("../../src/services/runViews.service.js");
const { default: AllocationRun } = await import("../../src/models/AllocationRun.js");
const { compareAllocationSchema, runSingleAllocationSchema } = await import("../../src/validators/allocation.schema.js");

describe("saving a run keeps the new metrics and settings", () => {
  it("does not drop groupLimitViolations, studentsMissingAGroup or cgpaPriorityViolations", () => {
    const run = new AllocationRun({
      semesterId: "S",
      baselineMetrics: { totalAssignments: 4, groupLimitViolations: 0, studentsMissingAGroup: 2, cgpaPriorityViolations: 9 },
      configuration: { optimizerFloor: "baseline", cgpaPriority: true, oneCoursePerGroup: true },
    });
    expect(run.baselineMetrics.cgpaPriorityViolations).toBe(9);
    expect(run.baselineMetrics.studentsMissingAGroup).toBe(2);
    expect(run.baselineMetrics.groupLimitViolations).toBe(0);
    expect(run.configuration).toMatchObject({ optimizerFloor: "baseline", cgpaPriority: true });
  });

  it("an older run reads as having no floor", () => {
    const run = new AllocationRun({ semesterId: "S" });
    expect(run.configuration.optimizerFloor).toBeNull();
    expect(run.configuration.cgpaPriority).toBe(false);
  });
});

describe("request settings", () => {
  it("the optimizer is held to the baseline and uses CGPA by default", () => {
    const compare = compareAllocationSchema.parse({ semesterId: "S" });
    expect(compare).toMatchObject({ optimizerFloor: "baseline", cgpaPriority: true });
    const single = runSingleAllocationSchema.parse({ semesterId: "S", algorithm: "optimized" });
    expect(single).toMatchObject({ optimizerFloor: "baseline", cgpaPriority: true });
  });

  it("accepts the baseline settings for the optimizer only while it is held to the baseline", () => {
    const body = { semesterId: "S", algorithm: "optimized", meritRatio: 0.6, randomRatio: 0.4, seed: 5 };
    expect(runSingleAllocationSchema.safeParse(body).success).toBe(true);
    expect(runSingleAllocationSchema.safeParse({ ...body, optimizerFloor: "none" }).success).toBe(false);
    expect(runSingleAllocationSchema.safeParse({ ...body, randomRatio: 0.3 }).success).toBe(false); // must sum to 1
  });

  it("rejects an unknown floor", () => {
    expect(compareAllocationSchema.safeParse({ semesterId: "S", optimizerFloor: "pure" }).success).toBe(false);
  });
});

describe("per-student evidence", () => {
  const students = [
    { id: "S1", cgpa: 9.5 }, { id: "S2", cgpa: 9.0 }, { id: "S3", cgpa: 8.0 },
    { id: "S4", cgpa: 7.0 }, { id: "S5", cgpa: 6.0 },
  ];
  const row = (algorithm, studentId, group, rank) => ({ algorithm, preferenceRank: rank, electiveGroup: group, student: { studentId } });
  const run = { _id: "r1", configuration: { optimizerFloor: "baseline" }, baselineMetrics: { cgpaPriorityViolations: 7 }, optimizedMetrics: { cgpaPriorityViolations: 2 } };

  beforeEach(() => {
    snapshotStudents = students;
    allocationRows = [
      // baseline
      row("baseline", "S1", "OE1", 1), row("baseline", "S2", "OE1", 1), row("baseline", "S3", "OE1", 3),
      row("baseline", "S4", "OE1", 5), row("baseline", "S5", "OE1", 9),
      // optimized: S3 and S5 improve, S4 gets nothing in OE1 (lost), S1/S2 unchanged; S5 also gains an OE2 slot
      row("optimized", "S1", "OE1", 1), row("optimized", "S2", "OE1", 1), row("optimized", "S3", "OE1", 2),
      row("optimized", "S5", "OE1", 4), row("optimized", "S5", "OE2", 1),
    ];
  });

  it("counts slots that are better, the same, worse (including a lost slot) or newly filled", async () => {
    const e = await comparisonEvidence(run);
    expect(e).toMatchObject({ slots: 5, better: 2, same: 2, worse: 1, gained: 1, heldToBaseline: true });
  });

  it("compares the top fifth by CGPA with everyone else, and the worst rank", async () => {
    const e = await comparisonEvidence(run);
    // top fifth = 1 student (S1): unchanged
    expect(e.topCgpa).toMatchObject({ students: 1, baselineAverageRank: 1, optimizedAverageRank: 1 });
    expect(e.others.students).toBe(4);
    expect(e.worstRank).toEqual({ baseline: 9, optimized: 4 });
  });

  it("reports the CGPA-priority violations of both algorithms", async () => {
    expect((await comparisonEvidence(run)).cgpaPriorityViolations).toEqual({ baseline: 7, optimized: 2 });
  });

  it("returns null instead of failing when there is nothing to compare", async () => {
    allocationRows = [];
    expect(await comparisonEvidence(run)).toBeNull();
  });
});
