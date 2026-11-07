/**
 * The "new run" form -> API request. Kept free of React so the rules are easy to test.
 *
 *   mode "both"      POST /allocations/compare  (merit/lottery split + seed apply to the baseline)
 *   mode "baseline"  POST /allocations/run      algorithm "baseline"
 *   mode "optimized" POST /allocations/run      algorithm "optimized"
 *
 * The optimizer is held to the baseline by default ("protectBaseline"): no student may end worse than
 * under the baseline's own result, which needs the same seat split and seed. Switching that off sends
 * no split or seed for an optimizer-only run (the API rejects them then).
 */

export const MAX_SEED = 4294967295;
export const MAX_COURSES_LIMIT = 10;

export const DEFAULT_RUN_FORM = {
  semesterId: "",
  mode: "both",
  maxCourses: 2,
  meritPercent: 70,
  seed: "",
  includeTimetable: true,
  protectBaseline: true,
  cgpaPriority: true,
};

export const includesBaseline = (mode) => mode === "both" || mode === "baseline";
export const includesOptimizer = (mode) => mode === "both" || mode === "optimized";

/** Is a seat split and seed in play: for the baseline, or for an optimizer held to the baseline's result? */
export const usesBaselineSettings = (form) =>
  includesBaseline(form.mode) || (form.mode === "optimized" && form.protectBaseline !== false);

/** @returns {Record<string, string>} field -> message (empty when the form is valid) */
export function validateRunForm(form) {
  const errors = {};
  if (!form.semesterId.trim()) errors.semesterId = "Choose the semester to run.";

  const courses = Number(form.maxCourses);
  if (!Number.isInteger(courses) || courses < 1 || courses > MAX_COURSES_LIMIT) {
    errors.maxCourses = `Enter a whole number from 1 to ${MAX_COURSES_LIMIT}.`;
  }

  if (usesBaselineSettings(form)) {
    const merit = Number(form.meritPercent);
    if (!Number.isFinite(merit) || merit < 0 || merit > 100) errors.meritPercent = "Choose a share from 0 to 100.";

    if (String(form.seed).trim() !== "") {
      const seed = Number(form.seed);
      if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) {
        errors.seed = `A seed is a whole number from 0 to ${MAX_SEED.toLocaleString("en-IN")}.`;
      }
    }
  }
  return errors;
}

/**
 * @param {typeof DEFAULT_RUN_FORM} form  already validated
 * @returns {{ kind: "compare" | "single", body: object }}
 */
export function buildRunRequest(form) {
  const base = {
    semesterId: form.semesterId.trim(),
    maxCoursesPerStudent: Number(form.maxCourses),
    includeTimetable: Boolean(form.includeTimetable),
  };

  // Baseline-only settings. Compute the lottery share from integer percents so the
  // two ratios always add up to exactly 1.
  const merit = Number(form.meritPercent);
  const baselineOnly = {
    meritRatio: merit / 100,
    randomRatio: (100 - merit) / 100,
  };
  const seedText = String(form.seed).trim();
  if (seedText !== "") baselineOnly.seed = Number(seedText);

  const protect = form.protectBaseline !== false;
  const optimizerSettings = {
    optimizerFloor: protect ? "baseline" : "none",
    cgpaPriority: form.cgpaPriority !== false,
  };

  if (form.mode === "both") return { kind: "compare", body: { ...base, ...baselineOnly, ...optimizerSettings } };
  if (form.mode === "baseline") return { kind: "single", body: { ...base, algorithm: "baseline", ...baselineOnly } };
  return {
    kind: "single",
    body: { ...base, algorithm: "optimized", ...optimizerSettings, ...(protect ? baselineOnly : {}) },
  };
}

/** Of the runs the server reports as running, the one most likely started by this form. */
export function pickRunningRun(runs, semesterId) {
  return (runs ?? [])
    .filter((r) => r.status === "running" && (!semesterId || r.semesterId === semesterId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
}
