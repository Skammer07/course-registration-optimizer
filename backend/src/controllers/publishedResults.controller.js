/**
 * src/controllers/publishedResults.controller.js
 */

import { asyncHandler } from "../utils/asyncHandler.js";
import { success } from "../utils/respond.js";
import { ApiError } from "../utils/ApiError.js";
import * as published from "../services/publishedResults.service.js";

export const myResults = asyncHandler(async (req, res) => {
  const data = await published.getMyPublishedResults(req.user.student);
  return success(res, data, "Your allocation results retrieved");
});

export const publishedRun = asyncHandler(async (req, res) => {
  let semesterId = req.query.semesterId?.toString().trim();
  // Students can only look up their own semester; they need not pass it.
  if (req.user.role === "student") {
    const mine = await published.getMyPublishedResults(req.user.student);
    if (semesterId && semesterId !== mine.semesterId) {
      throw ApiError.forbidden("You can only view the published run of your own semester.");
    }
    return success(
      res,
      { semesterId: mine.semesterId, published: mine.published, run: mine.run },
      "Published run retrieved"
    );
  }
  if (!semesterId) throw ApiError.badRequest("semesterId query parameter is required.");
  const data = await published.getPublishedRunInfo(semesterId);
  return success(res, data, "Published run retrieved");
});
