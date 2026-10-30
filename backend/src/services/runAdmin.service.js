/**
 * src/services/runAdmin.service.js
 * Admin operations on stored runs: cancel a running run, delete a run that was
 * never published, and verify (replay) a run against its stored snapshot.
 */

import mongoose from "mongoose";
import AllocationRun from "../models/AllocationRun.js";
import Allocation from "../models/Allocation.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../utils/logger.js";
import { cancelActiveRun, runFromSnapshot } from "./allocationEngine.service.js";
import { containedAlgorithms, assertViewable } from "./runViews.service.js";

const DELETABLE = ["completed", "failed", "cancelled"];

function validObjectId(runId) {
  if (!mongoose.isValidObjectId(runId)) throw ApiError.notFound("Allocation run");
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

/**
 * Cancel a run that is still "running". The run is marked "cancelled" first
 * (a conditional update, so a run that just completed is left alone), then the
 * worker is stopped if it is running in this process. The request that started
 * the run answers 409 ALLOCATION_CANCELLED and removes any partial assignments.
 *
 * A "running" run with no live worker (e.g. the server restarted mid-run) is
 * simply marked cancelled, which also clears such stale runs.
 */
export async function cancelRun(runId) {
  validObjectId(runId);
  const run = await AllocationRun.findById(runId).lean();
  if (!run) throw ApiError.notFound("Allocation run");
  if (run.status !== "running") {
    throw ApiError.conflict(`Only a running run can be cancelled (status: "${run.status}").`);
  }

  const marked = await AllocationRun.findOneAndUpdate(
    { _id: runId, status: "running" },
    { $set: { status: "cancelled", errorSummary: "Cancelled by an administrator." } },
    { new: true }
  ).lean();
  if (!marked) throw ApiError.conflict("The run is no longer running.");

  const workerStopped = cancelActiveRun(runId);
  try {
    await Allocation.deleteMany({ run: marked._id });
  } catch (err) {
    logger.error({ runId, err: err.message }, "Cleanup after cancel failed");
  }
  logger.info({ runId, workerStopped }, "Allocation run cancelled");
  return { run: marked, workerStopped };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Delete a run and its assignments. Only runs that were never published can be
 * deleted (completed, failed, cancelled). The run is removed with one
 * conditional delete, so a run that gets claimed for publication in the same
 * moment is not deleted.
 */
export async function deleteRun(runId) {
  validObjectId(runId);
  const deleted = await AllocationRun.findOneAndDelete({ _id: runId, status: { $in: DELETABLE } }).lean();

  if (!deleted) {
    const run = await AllocationRun.findById(runId).lean();
    if (!run) throw ApiError.notFound("Allocation run");
    if (run.status === "running") {
      throw ApiError.conflict("This run is still running; cancel it first.");
    }
    throw ApiError.conflict(`A run with status "${run.status}" cannot be deleted. Published results are kept for audit.`);
  }

  let removedAssignments = 0;
  try {
    const res = await Allocation.deleteMany({ run: deleted._id });
    removedAssignments = res?.deletedCount ?? 0;
  } catch (err) {
    logger.error({ runId, err: err.message }, "Run deleted but its assignments could not be removed");
  }
  logger.info({ runId, removedAssignments }, "Allocation run deleted");
  return { id: deleted._id, semesterId: deleted.semesterId, status: deleted.status, removedAssignments };
}

// ---------------------------------------------------------------------------
// Verify (replay)
// ---------------------------------------------------------------------------

// The merit iteration is a detail that older runs did not store, so the replay
// compares who got which course, at which rank, in which phase.
const keyOf = (studentId, courseId, rank, phase) =>
  `${studentId}|${courseId}|${rank}|${phase ?? ""}`;

function diffSets(stored, replayed) {
  const onlyInStored = [...stored].filter((k) => !replayed.has(k));
  const onlyInReplay = [...replayed].filter((k) => !stored.has(k));
  return { onlyInStored, onlyInReplay };
}

const label = (k) => {
  const [studentId, courseId, rank, phase] = k.split("|");
  return { studentId, courseId, preferenceRank: Number(rank), phase: phase || null };
};

/**
 * Re-run the selected algorithm(s) from the run's stored snapshot (and, for the
 * baseline, its stored seed and ratios) and compare with the stored assignments.
 * A mismatch means the stored data changed, or the algorithm code differs from
 * the version that produced the run (reported separately).
 */
export async function verifyRun(runId, { algorithm } = {}) {
  validObjectId(runId);
  const run = await AllocationRun.findById(runId).lean();
  if (!run) throw ApiError.notFound("Allocation run");
  assertViewable(run);

  const snapshot = run.inputSnapshot;
  if (!snapshot?.students?.length || !snapshot?.courses?.length || !snapshot?.preferences?.length) {
    throw ApiError.badRequest("This run has no stored input snapshot, so it cannot be replayed.");
  }

  const contained = containedAlgorithms(run);
  let targets = contained;
  if (algorithm) {
    if (!contained.includes(algorithm)) throw ApiError.badRequest(`This run has no "${algorithm}" results.`);
    targets = [algorithm];
  }

  const results = [];
  for (const alg of targets) {
    const options = { maxCoursesPerStudent: run.configuration?.maxCoursesPerStudent ?? 2 };
    if (alg === "baseline") {
      if (run.randomSeed === null || run.randomSeed === undefined) {
        results.push({
          algorithm: alg, matches: null, reason: "No random seed was stored for this baseline run, so it cannot be replayed.",
        });
        continue;
      }
      options.seed = run.randomSeed;
      options.meritRatio = run.configuration?.meritRatio ?? 0.75;
      options.randomRatio = run.configuration?.randomRatio ?? 0.25;
    }

    // Without the timetable the original could have been unconstrained: replay
    // exactly what the run used.
    const replayInput = {
      students: snapshot.students,
      courses: snapshot.courses,
      preferences: snapshot.preferences,
      timetable: snapshot.timetableIncluded === false ? null : snapshot.timetable ?? null,
    };

    let replay;
    try {
      replay = await runFromSnapshot({ algorithm: alg, snapshot: replayInput, options });
    } catch (err) {
      if (err.code === "ALLOCATION_TIMEOUT") {
        throw new ApiError(504, "The replay exceeded its time limit and was stopped.", "ALLOCATION_TIMEOUT");
      }
      logger.error({ runId, algorithm: alg, err: err.message }, "Replay failed");
      throw new ApiError(500, "The replay could not be completed.", "REPLAY_FAILED");
    }

    const rows = await Allocation.find({ run: run._id, algorithm: alg })
      .populate("student", "studentId")
      .populate("course", "courseCode")
      .lean();
    const stored = new Set(
      rows.map((r) => keyOf(r.student?.studentId, r.course?.courseCode, r.preferenceRank, r.phase))
    );
    const replayed = new Set(
      replay.allocations.map((a) => keyOf(a.studentId, a.courseId, a.preferenceRank, a.phase))
    );
    const { onlyInStored, onlyInReplay } = diffSets(stored, replayed);
    const currentVersion = replay.configuration?.algorithmVersion ?? null;
    const sameVersion = Boolean(run.algorithmVersion) && run.algorithmVersion === currentVersion;

    results.push({
      algorithm: alg,
      matches: onlyInStored.length === 0 && onlyInReplay.length === 0,
      storedCount: stored.size,
      replayedCount: replayed.size,
      onlyInStored: onlyInStored.slice(0, 20).map(label),
      onlyInReplay: onlyInReplay.slice(0, 20).map(label),
      storedVersion: run.algorithmVersion ?? null,
      currentVersion,
      sameVersion,
      seed: alg === "baseline" ? run.randomSeed : null,
      note: sameVersion
        ? null
        : "The algorithm version differs from the one that produced this run; a mismatch may be caused by the code change.",
    });
  }

  const checked = results.filter((r) => r.matches !== null);
  return {
    runId: run._id,
    results,
    allMatch: checked.length > 0 && checked.every((r) => r.matches === true),
  };
}
