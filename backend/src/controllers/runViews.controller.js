/**
 * src/controllers/runViews.controller.js
 * Dashboard views of a stored run (admin/faculty).
 */

import { asyncHandler } from "../utils/asyncHandler.js";
import { success } from "../utils/respond.js";
import * as views from "../services/runViews.service.js";

export const summary = asyncHandler(async (req, res) => {
  const data = await views.getRunSummary(req.params.runId);
  return success(res, data, "Run summary retrieved");
});

export const byStudent = asyncHandler(async (req, res) => {
  const data = await views.getResultsByStudent(req.params.runId, req.query);
  return success(res, data, "Results by student retrieved");
});

export const byCourse = asyncHandler(async (req, res) => {
  const data = await views.getResultsByCourse(req.params.runId, req.query);
  return success(res, data, "Results by course retrieved");
});

export const exportCsv = asyncHandler(async (req, res) => {
  const { filename, csv } = await views.buildRunCsv(req.params.runId, req.query);
  res.set({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  });
  return res.status(200).send(csv);
});
