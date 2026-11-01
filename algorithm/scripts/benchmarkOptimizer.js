/**
 * Benchmarks the optimizer on generated datasets and prints a fingerprint of
 * each result, so a change can be checked for identical output.
 *
 *   node scripts/benchmarkOptimizer.js [scenario:size:seed ...] [--out file.json]
 *
 * Example: node scripts/benchmarkOptimizer.js balanced:100:1 many-ties:100:1
 * With no cases, a small default set is used.
 */

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { generateDataset } from "../../backend/src/seed/generateDataset.js";
import { allocateOptimized } from "../src/algorithms/optimizedAllocation.js";

const DEFAULT_CASES = [
  "balanced:30:1",
  "balanced:100:1",
  "many-ties:100:1",
  "many-clashes:40:1",
  "scarce-seats:100:1",
];

function toInput(ds) {
  const timetable = {};
  for (const c of ds.courses) timetable[c.courseCode] = c.timetableSlots;

  const preferences = [];
  for (const p of ds.preferences) {
    p.courseCodes.forEach((code, i) =>
      preferences.push({ studentId: p.studentId, courseId: code, rank: i + 1 })
    );
  }

  return {
    students: ds.students.map((s) => ({ id: s.studentId, name: s.name, cgpa: s.cgpa })),
    courses: ds.courses.map((c) => ({ id: c.courseCode, name: c.title, capacity: c.capacity })),
    preferences,
    timetable,
  };
}

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outFile = outIndex >= 0 ? args[outIndex + 1] : null;
const cases = args.filter(
  (a, i) => !a.startsWith("--") && !(outIndex >= 0 && i === outIndex + 1)
);
const results = {};

for (const spec of cases.length ? cases : DEFAULT_CASES) {
  const [scenario, size, seed] = spec.split(":");
  const input = toInput(generateDataset({ scenario, size: Number(size), seed: Number(seed) }));
  const start = performance.now();
  const result = allocateOptimized(
    { students: input.students, courses: input.courses, preferences: input.preferences },
    { maxCoursesPerStudent: 2, timetable: input.timetable }
  );
  const ms = Math.round(performance.now() - start);

  const pairs = result.allocations.map((a) => `${a.studentId}:${a.courseId}`).sort().join("|");
  const fingerprint = createHash("sha256").update(pairs).digest("hex").slice(0, 16);

  results[spec] = {
    ms,
    flowSolves: result.assumptions.flowSolves,
    branches: result.assumptions.conflictBranches,
    assigned: result.totalAllocated,
    cost: result.totalPreferenceCost,
    fingerprint,
  };
  console.log(spec.padEnd(22), JSON.stringify(results[spec]));
}

if (outFile) writeFileSync(outFile, JSON.stringify(results, null, 2));
