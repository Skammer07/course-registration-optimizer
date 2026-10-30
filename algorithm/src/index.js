/**
 * Public entry point of the allocation algorithm package.
 * Import from here when using the algorithm on its own; the backend loads the
 * individual files by path (worker thread), so this does not affect it.
 */

export {
  runAllocationComparison,
  ALGORITHM_VERSION,
} from "./services/allocationComparisonService.js";
export { runSingleAllocation } from "./services/singleAllocationService.js";
export { runAllocation } from "./algorithms/allocationPipeline.js";
export { allocateOptimized } from "./algorithms/optimizedAllocation.js";
export { validateAllocation } from "./validation/validateAllocation.js";
export { calculateMetrics } from "./evaluation/metrics.js";
export { createSeededRandom, generateSeed } from "./utils/seededRandom.js";
