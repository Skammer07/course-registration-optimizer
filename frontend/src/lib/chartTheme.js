/**
 * Chart colours and ink. The two series colours are slots 1 (blue) and 2 (orange) of
 * the validated categorical palette: adjacent colour-blind separation 24.7 (protan),
 * normal-vision 33.6, contrast >= 3:1 on the light surface. Keep in sync with the
 * tokens in src/index.css. Baseline is always blue and optimized always orange, on
 * every screen.
 */
export const CHART = {
  baseline: "#2a78d6",
  optimized: "#eb6834",
  surface: "#fcfcfb",
  ink: "#0b0b0b",
  inkSecondary: "#52514e",
  muted: "#898781",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
};

export const ALGORITHM_META = {
  baseline: {
    key: "baseline",
    label: "Baseline",
    long: "Baseline (merit + random)",
    color: CHART.baseline,
    blurb: "Merit seats by CGPA (students served in CGPA order), then a random lottery for the remaining quota.",
  },
  optimized: {
    key: "optimized",
    label: "Optimized",
    long: "Optimized (min-cost max-flow)",
    color: CHART.optimized,
    blurb: "Maximizes the number of assignments, then minimizes preference cost. By default it is held to the baseline's result (no student ends worse) and uses CGPA to decide who gets the better choices among equal results.",
  },
};

export const ALGORITHMS = ["baseline", "optimized"];
