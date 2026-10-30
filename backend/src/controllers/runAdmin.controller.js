/**
 * src/controllers/runAdmin.controller.js
 * Cancel / delete / verify a stored run (admin).
 */

import { asyncHandler } from "../utils/asyncHandler.js";
import { success } from "../utils/respond.js";
import { logger } from "../utils/logger.js";
import * as admin from "../services/runAdmin.service.js";

export const cancel = asyncHandler(async (req, res) => {
  logger.info({ runId: req.params.runId, userId: req.user._id }, "Run cancellation requested");
  const data = await admin.cancelRun(req.params.runId);
  return success(res, data, "Run cancelled");
});

export const remove = asyncHandler(async (req, res) => {
  logger.info({ runId: req.params.runId, userId: req.user._id }, "Run deletion requested");
  const data = await admin.deleteRun(req.params.runId);
  return success(res, data, "Run deleted");
});

export const verify = asyncHandler(async (req, res) => {
  const data = await admin.verifyRun(req.params.runId, req.query);
  return success(res, data, data.allMatch ? "Replay matches the stored results" : "Replay finished");
});
