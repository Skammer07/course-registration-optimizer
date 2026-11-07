import { formatDuration, formatFixed, formatInt, formatPercentValue, formatSigned } from "./format.js";

/**
 * What each run metric means and which direction is "better". The backend declares no
 * overall winner (the two algorithms follow different policies); this only says, per
 * metric, which way a difference points. "neutral" metrics have no clear direction.
 */

export const METRICS = [
  { key: "totalAssignments", label: "Assignments made", unit: "count", better: "higher",
    help: "Total student-course assignments." },
  { key: "studentsWithAtLeastOneCourse", label: "Students with a course", unit: "count", better: "higher",
    help: "Students who received at least one course." },
  { key: "studentsWithTwoCourses", label: "Students with two courses", unit: "count", better: "neutral",
    help: "Students who received the maximum number of courses." },
  { key: "unallocatedStudents", label: "Students with no course", unit: "count", better: "lower",
    help: "Students who received nothing." },
  { key: "rank1Assignments", label: "First-choice assignments", unit: "count", better: "higher",
    help: "Assignments that were the student's top preference." },
  { key: "rank2Assignments", label: "Second-choice assignments", unit: "count", better: "neutral",
    help: "Assignments that were the student's second preference." },
  { key: "averagePreferenceRank", label: "Average preference rank", unit: "rank", better: "lower",
    help: "Mean rank of assigned courses; 1.00 means everyone got their first choice." },
  { key: "capacityUtilization", label: "Seat utilization", unit: "percent", better: "higher",
    help: "Share of all seats that were filled." },
  { key: "constraintViolations", label: "Rule violations", unit: "count", better: "lower",
    help: "Capacity, course-limit, duplicate and timetable violations. Must be zero." },
  { key: "timetableClashes", label: "Timetable clashes", unit: "count", better: "lower",
    help: "Students holding two courses that overlap in time." },
  { key: "studentsMissingAGroup", label: "Students missing a group", unit: "count", better: "lower",
    help: "Students who ranked courses in an elective group but received none from it." },
  { key: "cgpaPriorityViolations", label: "CGPA-priority violations", unit: "count", better: "lower",
    help: "A student ranked a course above the one they got, and a student with a lower CGPA holds it. The baseline's 30% lottery causes some by design." },
  { key: "groupLimitViolations", label: "Group-limit violations", unit: "count", better: "lower",
    help: "Extra courses beyond one per elective group. Must be zero." },
  { key: "runtimeMs", label: "Runtime", unit: "ms", better: "lower",
    help: "Computation time of the algorithm." },
];

export const METRIC_BY_KEY = Object.fromEntries(METRICS.map((m) => [m.key, m]));

/** The six same-unit counts shown in the side-by-side chart. */
export const CHART_METRIC_KEYS = [
  "totalAssignments",
  "studentsWithAtLeastOneCourse",
  "studentsWithTwoCourses",
  "unallocatedStudents",
  "rank1Assignments",
  "rank2Assignments",
];

/** The headline tiles on the overview, in reading order. */
export const HEADLINE_KEYS = [
  "totalAssignments",
  "unallocatedStudents",
  "averagePreferenceRank",
  "rank1Assignments",
  "capacityUtilization",
  "constraintViolations",
];

/** Which way does a difference (optimized minus baseline) point for this metric? */
export function directionOf(metricKey, difference) {
  const metric = METRIC_BY_KEY[metricKey];
  if (!metric || !Number.isFinite(difference) || difference === 0) return "none";
  if (metric.better === "neutral") return "neutral";
  const up = difference > 0;
  return (metric.better === "higher") === up ? "favorable" : "unfavorable";
}

/** Metric value from either a metrics object or the runtime field of a side. */
export function metricValue(side, key) {
  if (!side) return undefined;
  if (key === "runtimeMs") return side.runtimeMs;
  return side.metrics?.[key];
}

/** A metric value in its natural unit: 34, 1.41, 87.2%, 8.2 ms. */
export function formatMetric(key, value) {
  const unit = METRIC_BY_KEY[key]?.unit;
  if (unit === "rank") return formatFixed(value, 2);
  if (unit === "percent") return formatPercentValue(value, 1);
  if (unit === "ms") return formatDuration(value);
  return formatInt(value);
}

/** A signed difference in the metric's unit: +5, −0.36, +12.8 points, −5.3 ms. */
export function formatDifference(key, difference) {
  const unit = METRIC_BY_KEY[key]?.unit;
  if (!Number.isFinite(difference)) return "–";
  if (unit === "rank") return formatSigned(difference, 2);
  if (unit === "percent") return difference === 0 ? "0" : `${formatSigned(difference, 1)} pts`;
  if (unit === "ms") return difference === 0 ? "0" : `${formatSigned(difference, Math.abs(difference) < 10 ? 1 : 0)} ms`;
  return formatSigned(difference, 0);
}
