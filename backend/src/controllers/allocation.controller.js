/**
 * src/controllers/allocation.controller.js
 */

import { asyncHandler } from "../utils/asyncHandler.js";
import { success, created } from "../utils/respond.js";
import * as allocationService from "../services/allocation.service.js";
import { logger } from "../utils/logger.js";

export const compare = asyncHandler(async (req, res) => {
  const {
    semesterId,
    maxCoursesPerStudent,
    meritRatio,
    randomRatio,
    includeTimetable,
    optimizerFloor,
    cgpaPriority,
    seed,
  } = req.body;

  logger.info(
    { semesterId, userId: req.user._id },
    "Allocation comparison requested"
  );

  const run = await allocationService.executeAllocationComparison({
    semesterId,
    maxCoursesPerStudent,
    meritRatio,
    randomRatio,
    includeTimetable,
    optimizerFloor,
    cgpaPriority,
    seed,
    createdByUserId: req.user._id.toString(),
  });

  return created(res, { run }, "Allocation comparison completed");
});

export const runSingle = asyncHandler(async (req, res) => {
  logger.info(
    { semesterId: req.body.semesterId, algorithm: req.body.algorithm, userId: req.user._id },
    "Single-algorithm allocation requested"
  );
  const run = await allocationService.executeSingleAllocation({
    ...req.body,
    createdByUserId: req.user._id.toString(),
  });
  return created(res, { run }, `Allocation run completed (${req.body.algorithm})`);
});

export const compareRuns = asyncHandler(async (req, res) => {
  const comparison = await allocationService.compareRuns(req.query);
  return success(res, { comparison }, "Runs compared");
});

export const listRuns = asyncHandler(async (req, res) => {
  const result = await allocationService.listAllocationRuns(req.query);
  return success(res, result, "Allocation runs retrieved");
});

export const getRun = asyncHandler(async (req, res) => {
  const run = await allocationService.getAllocationRunById(req.params.runId);
  return success(res, { run }, "Allocation run retrieved");
});

export const getRunResults = asyncHandler(async (req, res) => {
  const result = await allocationService.getRunResults(req.params.runId, req.query);
  return success(res, result, "Allocation results retrieved");
});

export const publishRun = asyncHandler(async (req, res) => {
  const { algorithm } = req.body;

  logger.info(
    { runId: req.params.runId, userId: req.user._id, algorithm },
    "Allocation publication requested"
  );

  const run = await allocationService.publishAllocationRun(
    req.params.runId,
    req.user._id.toString(),
    algorithm
  );

  return success(res, { run }, `Allocation run published (${algorithm})`);
});

