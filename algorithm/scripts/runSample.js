
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { runAllocation } from "../src/algorithms/allocationPipeline.js";
import { allocateOptimized } from "../src/algorithms/optimizedAllocation.js";
import { compareAllocations } from "../src/evaluation/compare.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

function readJson(relativePath) {
  const fullPath = path.join(projectRoot, relativePath);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

function runAndMeasure(fn) {
  const start = performance.now();
  const result = fn();
  const runtimeMs = Number((performance.now() - start).toFixed(3));

  return { result, runtimeMs };
}

function printMetrics(name, metrics, runtimeMs) {
  console.log(`\n${name}`);

  console.table([
    { metric: "Total assignments", value: metrics.totalAssignments },
    {
      metric: "Students with at least one course",
      value: metrics.studentsWithAtLeastOneCourse,
    },
    {
      metric: "Students with two courses",
      value: metrics.studentsWithTwoCourses,
    },
    { metric: "Unallocated students", value: metrics.unallocatedStudents },
    { metric: "Rank-1 preferences", value: metrics.rank1Assignments },
    {
      metric: "Average preference rank",
      value: metrics.averagePreferenceRank ?? "N/A",
    },
    { metric: "Capacity violations", value: metrics.capacityViolations },
    {
      metric: "Student limit violations",
      value: metrics.studentLimitViolations,
    },
    {
      metric: "Duplicate assignments",
      value: metrics.duplicateAssignments,
    },
    { metric: "Timetable clashes", value: metrics.timetableClashes },
    {
      metric: "Total constraint violations",
      value: metrics.constraintViolations,
    },
    { metric: "Runtime (ms)", value: runtimeMs },
  ]);
}

function main() {
  const students = readJson("data/samples/students.json");
  const courses = readJson("data/samples/courses.json");
  const preferences = readJson("data/samples/preferences.json");
  const timetable = readJson("data/timetable/mock_timetable.json");

  const input = { students, courses, preferences, timetable };

  // Baseline: merit phase followed by random phase.
  const baselineRun = runAndMeasure(() =>
    runAllocation(
      { students, courses, preferences },
      {
        meritRatio: 0.75,
        randomRatio: 0.25,
        maxCoursesPerStudent: 2,
        random: () => 0.5,
        timetable,
      }
    )
  );

  // Optimizer: MCMF across all available course capacity.
  const optimizedRun = runAndMeasure(() =>
    allocateOptimized(
      { students, courses, preferences },
      {
        maxCoursesPerStudent: 2,
        timetable,
      }
    )
  );

  const comparison = compareAllocations({
    input,
    baseline: baselineRun.result,
    optimized: optimizedRun.result,
    baselineRuntimeMs: baselineRun.runtimeMs,
    optimizedRuntimeMs: optimizedRun.runtimeMs,
  });

  console.log("\n========== COURSE ALLOCATION COMPARISON ==========");
  console.log(`Students: ${students.length}`);
  console.log(`Courses: ${courses.length}`);
  console.log(
    `Total available seats: ${courses.reduce((sum, c) => sum + c.capacity, 0)}`
  );

  printMetrics(
    "BASELINE: MERIT + RANDOM",
    comparison.baseline.metrics,
    baselineRun.runtimeMs
  );

  printMetrics(
    "OPTIMIZED: MIN-COST MAX-FLOW",
    comparison.optimized.metrics,
    optimizedRun.runtimeMs
  );

  console.log("\n========== IMPROVEMENT (OPTIMIZED VS BASELINE) ==========");
  console.table(
    Object.entries(comparison.improvement).map(([metric, change]) => ({
      metric,
      change,
    }))
  );

  console.log("\n========== VALIDATION ==========");
  console.log(
    "Baseline has zero constraint violations:",
    comparison.baseline.metrics.constraintViolations === 0
  );
  console.log(
    "Optimizer has zero constraint violations:",
    comparison.optimized.metrics.constraintViolations === 0
  );
  console.log("Both results valid:", comparison.validComparison);

  console.log("\n========== POLICY DIFFERENCES ==========");
  console.log(
    "Baseline: separate merit and random quotas; unused merit quota does not transfer."
  );
  console.log(
    "Optimizer: optimizes over all available course capacity; does not preserve merit/random quotas."
  );

  console.log("\n========== OPTIMIZED ALLOCATIONS ==========");
  console.table(optimizedRun.result.allocations);

  console.log("\n========== OPTIMIZER DETAILS ==========");
  console.log(optimizedRun.result.assumptions);
}

try {
  main();
} catch (error) {
  console.error("\nFailed to run allocation comparison:");
  console.error(error.stack ?? error);
  process.exitCode = 1;
}
