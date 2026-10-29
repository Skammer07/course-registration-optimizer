
import { describe, it, expect } from "vitest";

import { runAllocationComparison } from "../src/services/allocationComparisonService.js";

import students from "../../data/samples/students.json" with { type: "json" };
import courses from "../../data/samples/courses.json" with { type: "json" };
import preferences from "../../data/samples/preferences.json" with { type: "json" };
import timetable from "../../data/timetable/mock_timetable.json" with { type: "json" };

describe("allocation comparison service", () => {
  it("returns both allocation results, metrics and validation", () => {
    const result = runAllocationComparison(
      { students, courses, preferences, timetable },
      { random: () => 0.5 }
    );

    expect(result.success).toBe(true);

    expect(result.baseline.allocations).toBeInstanceOf(Array);
    expect(result.optimized.allocations).toBeInstanceOf(Array);

    expect(result.baseline.validation.valid).toBe(true);
    expect(result.optimized.validation.valid).toBe(true);

    expect(result.baseline.metrics.constraintViolations).toBe(0);
    expect(result.optimized.metrics.constraintViolations).toBe(0);

    expect(result.comparison).toHaveProperty("improvement");
    expect(result.configuration.timetableValidationEnabled).toBe(true);

    // The complete response should be JSON-serializable.
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("rejects invalid configuration", () => {
    expect(() =>
      runAllocationComparison(
        { students, courses, preferences, timetable },
        { maxCoursesPerStudent: 0 }
      )
    ).toThrow("maxCoursesPerStudent must be a positive integer.");
  });
});
