import { describe, expect, it, vi } from "vitest";
import {
  formatClock, formatDuration, formatFixed, formatFraction, formatPercentValue, formatRelative, formatSigned, ordinal, plural,
} from "./format.js";
import { METRICS, METRIC_BY_KEY, directionOf, formatDifference, formatMetric } from "./metrics.js";
import { describeError } from "./errors.js";
import { shouldRetry } from "./queryClient.js";

describe("format", () => {
  it("formats durations from microseconds to minutes", () => {
    expect(formatDuration(0.4)).toBe("<1 ms");
    expect(formatDuration(8.226)).toBe("8.2 ms");
    expect(formatDuration(55.004)).toBe("55 ms");
    expect(formatDuration(2899)).toBe("2.9 s");
    expect(formatDuration(39182)).toBe("39 s");
    expect(formatDuration(65_000)).toBe("1 min 5 s");
    expect(formatDuration(undefined)).toBe("–");
  });

  it("keeps percentages and fractions apart (metrics hold 87.18, by-course holds 0.5)", () => {
    expect(formatPercentValue(87.18)).toBe("87.2%");
    expect(formatFraction(0.5)).toBe("50%");
    expect(formatFraction(1)).toBe("100%");
    expect(formatPercentValue(null)).toBe("–");
  });

  it("signs differences with a real minus and no sign for zero", () => {
    expect(formatSigned(5)).toBe("+5");
    expect(formatSigned(-6)).toBe("−6");
    expect(formatSigned(0)).toBe("0");
    expect(formatSigned(-0.36, 2)).toBe("−0.36");
    expect(formatSigned(1234)).toBe("+1,234");
  });

  it("covers ordinals, plurals, clock and fixed digits", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual(
      ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th"]
    );
    expect(plural(1, "student")).toBe("1 student");
    expect(plural(2, "student")).toBe("2 students");
    expect(formatClock(65)).toBe("01:05");
    expect(formatClock(-3)).toBe("00:00");
    expect(formatFixed(1.4)).toBe("1.40");
  });

  it("describes times relative to now", () => {
    const now = Date.UTC(2026, 5, 1, 12, 0, 0);
    expect(formatRelative(new Date(now - 2 * 3_600_000).toISOString(), now)).toBe("2 hours ago");
    expect(formatRelative(new Date(now - 20_000).toISOString(), now)).toBe("just now");
    expect(formatRelative(null)).toBe("–");
  });
});

describe("metrics", () => {
  it("knows which way is better for each metric, and that some have no direction", () => {
    expect(directionOf("totalAssignments", 5)).toBe("favorable");
    expect(directionOf("totalAssignments", -5)).toBe("unfavorable");
    expect(directionOf("unallocatedStudents", 6)).toBe("unfavorable");
    expect(directionOf("unallocatedStudents", -2)).toBe("favorable");
    expect(directionOf("averagePreferenceRank", -0.36)).toBe("favorable");
    expect(directionOf("runtimeMs", -5.3)).toBe("favorable");
    expect(directionOf("studentsWithTwoCourses", 11)).toBe("neutral");
    expect(directionOf("totalAssignments", 0)).toBe("none");
    expect(directionOf("totalAssignments", undefined)).toBe("none");
    expect(directionOf("nonsense", 3)).toBe("none");
  });

  it("formats values and differences in each metric's unit", () => {
    expect(formatMetric("totalAssignments", 1234)).toBe("1,234");
    expect(formatMetric("averagePreferenceRank", 1.4)).toBe("1.40");
    expect(formatMetric("capacityUtilization", 87.18)).toBe("87.2%");
    expect(formatMetric("runtimeMs", 8.226)).toBe("8.2 ms");
    expect(formatDifference("totalAssignments", 5)).toBe("+5");
    expect(formatDifference("averagePreferenceRank", -0.36)).toBe("−0.36");
    expect(formatDifference("capacityUtilization", 12.82)).toBe("+12.8 pts");
    expect(formatDifference("runtimeMs", -5.327)).toBe("−5.3 ms");
    expect(formatDifference("totalAssignments", null)).toBe("–");
  });

  it("every metric has a label, a unit and a direction", () => {
    for (const m of METRICS) {
      expect(m.label).toBeTruthy();
      expect(["count", "rank", "percent", "ms"]).toContain(m.unit);
      expect(["higher", "lower", "neutral"]).toContain(m.better);
    }
    expect(Object.keys(METRIC_BY_KEY)).toHaveLength(METRICS.length);
  });
});

describe("describeError", () => {
  it("gives known codes a plain title and hint", () => {
    const e = describeError({ code: "ALLOCATION_TIMEOUT", message: "stopped", requestId: "r1" });
    expect(e.title).toMatch(/took too long/);
    expect(e.hint).toMatch(/timetable/);
    expect(e.requestId).toBe("r1");
  });

  it("falls back for unknown codes and non-API errors", () => {
    expect(describeError({ code: "WEIRD", message: "boom" })).toMatchObject({ title: "Something went wrong", message: "boom" });
    expect(describeError(new Error("plain"))).toMatchObject({ message: "plain", details: [] });
    expect(describeError(null).message).toMatch(/unexpected/);
  });

  it("formats every kind of detail the API sends", () => {
    const e = describeError({
      code: "IMPORT_VALIDATION_FAILED",
      message: "2 problems",
      details: ["plain text", { row: 3, column: "cgpa", message: "must be 0 to 10" }, { field: "email", message: "invalid" }, { message: "just a message" }, {}, null],
    });
    expect(e.details).toEqual(["plain text", "Row 3, cgpa: must be 0 to 10", "email: invalid", "just a message"]);
  });
});

describe("query retry policy", () => {
  it("retries server and network failures a couple of times, never client errors", () => {
    expect(shouldRetry(0, { status: 500 })).toBe(true);
    expect(shouldRetry(1, { status: 0 })).toBe(true);
    expect(shouldRetry(2, { status: 500 })).toBe(false);
    expect(shouldRetry(0, { status: 404 })).toBe(false);
    expect(shouldRetry(0, { status: 401 })).toBe(false);
  });
});

describe("fixtures stay faithful to the real API", () => {
  it("percent metrics are percentages, by-course utilization is a fraction", async () => {
    const { fixture } = await import("../test/utils.jsx");
    const summary = fixture("summary-both").data;
    const util = summary.algorithms.baseline.metrics.capacityUtilization;
    expect(util).toBeGreaterThan(1); // 87.18, not 0.8718
    const course = fixture("by-course").data.courses[0];
    expect(course.utilization).toBeLessThanOrEqual(1);
    vi.restoreAllMocks();
  });
});
