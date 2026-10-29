
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAllocation } from "../src/algorithms/allocationPipeline.js";
import { allocateOptimized } from "../src/algorithms/optimizedAllocation.js";
import { calculateMetrics } from "../src/evaluation/metrics.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "../..");

function loadJson(relativePath) {
  return JSON.parse(
    fs.readFileSync(path.join(projectRoot, relativePath), "utf8")
  );
}

describe("sample dataset regression", () => {
  const students = loadJson("data/samples/students.json");
  const courses = loadJson("data/samples/courses.json");
  const preferences = loadJson("data/samples/preferences.json");
  const timetable = loadJson("data/timetable/mock_timetable.json");

  it("baseline produces 12 valid assignments", () => {
    const result = runAllocation(
      { students, courses, preferences },
      {
        meritRatio: 0.75,
        randomRatio: 0.25,
        maxCoursesPerStudent: 2,
        random: () => 0.5,
        timetable,
      }
    );

    expect(result.allocations).toHaveLength(12);

    const metrics = calculateMetrics({
      students,
      courses,
      preferences,
      allocations: result.allocations,
      timetable,
      maxCoursesPerStudent: 2,
    });

    expect(metrics.constraintViolations).toBe(0);
  });

  it("optimizer produces valid assignments for the sample dataset", () => {
    const result = allocateOptimized(
      { students, courses, preferences },
      {
        maxCoursesPerStudent: 2,
        timetable,
      }
    );

    const metrics = calculateMetrics({
      students,
      courses,
      preferences,
      allocations: result.allocations,
      timetable,
      maxCoursesPerStudent: 2,
    });

    expect(metrics.constraintViolations).toBe(0);
    expect(result.totalAllocated).toBe(result.allocations.length);
    expect(result.totalAllocated).toBeGreaterThanOrEqual(0);
    expect(result.totalAllocated).toBeLessThanOrEqual(12);
  });
});
