/**
 * tests/integration/algorithm.integration.test.js
 * Integration test that invokes the real existing algorithm with synthetic data.
 * Does NOT require a database.
 */

import { describe, it, expect } from "vitest";
import { runAllocationComparison } from "../../../algorithm/src/services/allocationComparisonService.js";
import { algStudents, algCourses, algPreferences } from "../fixtures/sampleData.js";

describe("Algorithm integration: runAllocationComparison with real algorithm", () => {
  it("runs successfully with valid synthetic data", () => {
    const result = runAllocationComparison(
      { students: algStudents, courses: algCourses, preferences: algPreferences },
      { maxCoursesPerStudent: 2, meritRatio: 0.75, randomRatio: 0.25 }
    );

    expect(result.success).toBe(true);
    expect(Array.isArray(result.baseline.allocations)).toBe(true);
    expect(Array.isArray(result.optimized.allocations)).toBe(true);
    expect(result.baseline.validation.valid).toBe(true);
    expect(result.optimized.validation.valid).toBe(true);
    expect(result.baseline.metrics.constraintViolations).toBe(0);
    expect(result.optimized.metrics.constraintViolations).toBe(0);
  });

  it("throws on missing required fields", () => {
    expect(() => runAllocationComparison(null)).toThrow("Input is required.");
    expect(() =>
      runAllocationComparison({ students: [], courses: [] })
    ).toThrow("students, courses, and preferences arrays");
  });

  it("throws on invalid maxCoursesPerStudent", () => {
    expect(() =>
      runAllocationComparison(
        { students: algStudents, courses: algCourses, preferences: algPreferences },
        { maxCoursesPerStudent: 0 }
      )
    ).toThrow("maxCoursesPerStudent must be a positive integer");
  });

  it("throws on out-of-range meritRatio", () => {
    expect(() =>
      runAllocationComparison(
        { students: algStudents, courses: algCourses, preferences: algPreferences },
        { meritRatio: 1.5 }
      )
    ).toThrow("meritRatio must be between 0 and 1");
  });

  it("respects maxCoursesPerStudent constraint", () => {
    const result = runAllocationComparison(
      { students: algStudents, courses: algCourses, preferences: algPreferences },
      { maxCoursesPerStudent: 1 }
    );

    // No student should have more than 1 course
    const studentCounts = new Map();
    for (const a of result.optimized.allocations) {
      studentCounts.set(a.studentId, (studentCounts.get(a.studentId) ?? 0) + 1);
    }
    for (const [, count] of studentCounts) {
      expect(count).toBeLessThanOrEqual(1);
    }
  });

  it("produces valid allocations that do not exceed course capacities", () => {
    const result = runAllocationComparison(
      { students: algStudents, courses: algCourses, preferences: algPreferences },
      { maxCoursesPerStudent: 2 }
    );

    // Check baseline
    const baselineCounts = new Map();
    for (const a of result.baseline.allocations) {
      baselineCounts.set(a.courseId, (baselineCounts.get(a.courseId) ?? 0) + 1);
    }
    for (const course of algCourses) {
      expect(baselineCounts.get(course.id) ?? 0).toBeLessThanOrEqual(course.capacity);
    }

    // Check optimized
    const optimizedCounts = new Map();
    for (const a of result.optimized.allocations) {
      optimizedCounts.set(a.courseId, (optimizedCounts.get(a.courseId) ?? 0) + 1);
    }
    for (const course of algCourses) {
      expect(optimizedCounts.get(course.id) ?? 0).toBeLessThanOrEqual(course.capacity);
    }
  });
});

