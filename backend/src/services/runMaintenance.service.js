/**
 * src/services/runMaintenance.service.js
 * Housekeeping for runs that can never finish on their own.
 *
 * A run is "running" only while a worker thread computes it inside the request
 * that started it. If the server crashes or restarts meanwhile, nothing ever
 * moves the run out of "running". This sweep marks such runs failed and removes
 * any partial assignments. Only runs older than twice the allocation time limit
 * (plus a minute) are touched, so a healthy long run, or one on another
 * instance, is never interrupted.
 */

import AllocationRun from "../models/AllocationRun.js";
import Allocation from "../models/Allocation.js";
import { logger } from "../utils/logger.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const GRACE_MS = 60_000;
export const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export function staleRunCutoff(now = Date.now()) {
  const limit = Number(process.env.ALLOCATION_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  return new Date(now - (2 * limit + GRACE_MS));
}

/**
 * @returns {Promise<{ failed: number }>} how many stale runs were marked failed
 */
export async function failStaleRuns(now = Date.now()) {
  const cutoff = staleRunCutoff(now);
  const stale = await AllocationRun.find({ status: "running", createdAt: { $lt: cutoff } })
    .select("_id")
    .lean();
  if (stale.length === 0) return { failed: 0 };

  const ids = stale.map((r) => r._id);
  await Allocation.deleteMany({ run: { $in: ids } });
  const res = await AllocationRun.updateMany(
    { _id: { $in: ids }, status: "running" },
    {
      $set: {
        status: "failed",
        errorSummary: "Marked failed automatically: the run did not finish (server restart or crash).",
      },
    }
  );
  const failed = res?.modifiedCount ?? res?.nModified ?? ids.length;
  logger.warn({ failed }, "Stale running allocation runs marked failed");
  return { failed };
}

/**
 * Run the sweep now and then periodically. Returns a function that stops it.
 * The timer is unref'd so it never keeps the process alive.
 */
export function startRunSweeper({ intervalMs = SWEEP_INTERVAL_MS } = {}) {
  const tick = () =>
    failStaleRuns().catch((err) => logger.error({ err: err.message }, "Stale-run sweep failed"));
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
