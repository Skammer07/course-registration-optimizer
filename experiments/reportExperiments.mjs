/**
 * experiments/reportExperiments.mjs
 *
 * Runs BOTH algorithms (baseline and optimizer) on freshly generated realistic data, with the same
 * options and search limits the backend uses, and records what they did. No database is needed.
 *
 *   node experiments/reportExperiments.mjs [cases] [--out experiments/results/report-experiments.json]
 *
 * A case is  <students>:<seed>[:<seatFactor>]  (default seat factor 1.04, the one SEM-2 was seeded with).
 * Default cases: 200:11  500:11  1000:1 1000:2 1000:3 1000:4 1000:5  1500:11
 *
 * The input is built with the backend's own functions (normalize*, buildTimetableMap, buildFixedTimetable),
 * so it has the same shape as a run started from the web app.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const load = (rel) => import(pathToFileURL(resolve(root, rel)).href);

const { generateRealistic } = await load("backend/src/seed/generateRealistic.js");
const engine = await load("backend/src/services/allocationEngine.service.js");
const { runAllocationComparison, ALGORITHM_VERSION } = await load("algorithm/src/services/allocationComparisonService.js");

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outFile = outIndex >= 0 ? args[outIndex + 1] : resolve(here, "results/report-experiments.json");
const caseArgs = args.filter((a, i) => !a.startsWith("--") && (outIndex < 0 || i !== outIndex + 1));
const cases = (caseArgs.length ? caseArgs : ["200:11", "500:11", "1000:1", "1000:2", "1000:3", "1000:4", "1000:5", "1500:11"]).map((c) => {
  const [size, seed, seatFactor] = c.split(":");
  return { size: Number(size), seed: Number(seed), seatFactor: seatFactor ? Number(seatFactor) : 1.04 };
});

// the options the backend passes (see buildOptions in allocationEngine.service.js)
const options = {
  maxWork: engine.OPTIMIZER_MAX_WORK,
  maxFlowSolves: engine.OPTIMIZER_MAX_FLOW_SOLVES,
  searchTimeLimitMs: engine.OPTIMIZER_SEARCH_TIME_LIMIT_MS,
  maxCoursesPerStudent: 2,
  meritRatio: 0.7,
  randomRatio: 0.3,
  oneCoursePerGroup: true,
  optimizerFloor: "baseline",
  cgpaPriority: true,
};

function buildInput(data) {
  const electives = data.courses.filter((c) => c.kind !== "compulsory");
  const compulsory = data.courses.filter((c) => c.kind === "compulsory");
  const prefDocs = data.preferences
    .filter((p) => p.status === "submitted")
    .map((p) => ({
      student: { studentId: p.studentId },
      electiveGroup: p.electiveGroup,
      rankedCourseIds: p.courseCodes.map((code) => ({ courseCode: code })),
    }));
  const timetable = engine.buildTimetableMap(electives);
  const { fixedTimetable } = engine.buildFixedTimetable({ students: data.students, compulsoryCourses: compulsory });
  return {
    students: engine.normalizeStudents(data.students),
    courses: engine.normalizeCourses(electives),
    preferences: engine.normalizePreferences(prefDocs),
    timetable,
    fixedTimetable,
  };
}

// per (student, group): is the optimizer's course ranked better / the same / worse than the baseline's?
function compareByStudent(baseline, optimized) {
  const key = (a) => `${a.studentId}::${a.electiveGroup}`;
  const opt = new Map(optimized.allocations.map((a) => [key(a), a.preferenceRank]));
  const base = new Map(baseline.allocations.map((a) => [key(a), a.preferenceRank]));
  let better = 0, same = 0, worse = 0, newlyFilled = 0;
  for (const [k, r] of base) {
    const o = opt.get(k);
    if (o === undefined) worse++;
    else if (o < r) better++;
    else if (o === r) same++;
    else worse++;
  }
  for (const k of opt.keys()) if (!base.has(k)) newlyFilled++;
  return { better, same, worse, newlyFilled };
}

const cost = (allocs) => allocs.reduce((n, a) => n + (a.preferenceRank - 1), 0);
const pick = (m) => ({
  assignments: m.totalAssignments,
  studentsWithTwoCourses: m.studentsWithTwoCourses,
  unallocatedStudents: m.unallocatedStudents,
  firstChoice: m.rank1Assignments,
  secondChoice: m.rank2Assignments,
  averageRank: m.averagePreferenceRank,
  seatUtilization: m.capacityUtilization,
  studentsMissingAGroup: m.studentsMissingAGroup,
  cgpaPriorityViolations: m.cgpaPriorityViolations,
  ruleViolations: m.constraintViolations,
});

const results = [];

for (const c of cases) {
  const data = generateRealistic({ semesterId: `GEN-${c.size}-${c.seed}`, size: c.size, seed: c.seed, seatFactor: c.seatFactor });
  const input = buildInput(data);
  const seed = 1000 + c.seed; // fixed lottery seed so the run repeats
  const t0 = Date.now();
  const r = runAllocationComparison(structuredClone(input), { ...options, seed });
  const wall = Date.now() - t0;
  const a = r.optimized.assumptions;
  const row = {
    case: c,
    algorithmVersion: ALGORITHM_VERSION,
    lotterySeed: seed,
    seats: data.meta.totalSeats,
    students: c.size,
    rankedEntries: input.preferences.length,
    baseline: { ...pick(r.baseline.metrics), totalPreferenceCost: cost(r.baseline.allocations), runtimeMs: r.baseline.runtimeMs },
    optimized: { ...pick(r.optimized.metrics), totalPreferenceCost: r.optimized.totalPreferenceCost, runtimeMs: r.optimized.runtimeMs },
    byStudent: compareByStudent(r.baseline, r.optimized),
    search: {
      optimal: a.optimal,
      stopReason: a.searchStopReason,
      searchBound: a.searchBound,
      flowSolves: a.flowSolves,
      conflictBranches: a.conflictBranches,
      cgpaPriorityApplied: a.cgpaPriority,
      preferencesRemovedByFixedSlots: a.preferencesRemovedByFixedSlots,
      preferencesRemovedByFloor: a.preferencesRemovedByFloor,
    },
    wallMs: wall,
  };
  results.push(row);
  console.log(
    `${String(c.size).padStart(5)} students seed ${c.seed}: assignments ${row.baseline.assignments} -> ${row.optimized.assignments}, ` +
      `avg rank ${row.baseline.averageRank} -> ${row.optimized.averageRank}, cost ${row.baseline.totalPreferenceCost} -> ${row.optimized.totalPreferenceCost}, ` +
      `worse ${row.byStudent.worse}, violations ${row.baseline.ruleViolations}/${row.optimized.ruleViolations}, ` +
      `optimal ${a.optimal}${a.searchStopReason ? ` (${a.searchStopReason})` : ""}, ${row.baseline.runtimeMs} ms vs ${row.optimized.runtimeMs} ms`
  );
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), options, results }, null, 2));
console.log(`\nSaved ${results.length} runs to ${outFile}`);
