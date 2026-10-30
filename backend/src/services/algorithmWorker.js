/**
 * src/services/algorithmWorker.js
 * Worker-thread entry point: runs ONE algorithm call off the main thread so a
 * long computation can neither freeze the API nor outlive its time limit
 * (the parent terminates the worker on timeout).
 *
 * Plain Node ESM on purpose: it imports only the algorithm package by file URL.
 */

import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import path from "node:path";

const { kind, algorithmRoot, input, options } = workerData;

const MODULES = {
  comparison: ["src/services/allocationComparisonService.js", "runAllocationComparison"],
  single: ["src/services/singleAllocationService.js", "runSingleAllocation"],
};

try {
  const [file, fn] = MODULES[kind];
  const mod = await import(pathToFileURL(path.join(algorithmRoot, file)).href);
  parentPort.postMessage({ ok: true, result: mod[fn](input, options) });
} catch (err) {
  parentPort.postMessage({ ok: false, error: String(err?.message ?? err) });
}
