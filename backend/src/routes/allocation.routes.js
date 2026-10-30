/**
 * src/routes/allocation.routes.js
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
  compareAllocationSchema,
  runSingleAllocationSchema,
  compareRunsQuerySchema,
  runQuerySchema,
  runResultsQuerySchema,
  publishAllocationSchema,
} from "../validators/allocation.schema.js";
import * as ctrl from "../controllers/allocation.controller.js";

const router = Router();

router.use(requireAuth);

/**
 * POST /api/v1/allocations/compare
 * Trigger an allocation comparison run for a semester.
 * Admin only.
 */
router.post(
  "/compare",
  requireRole("admin"),
  validate(compareAllocationSchema),
  ctrl.compare
);

/**
 * POST /api/v1/allocations/run
 * Run ONE selected algorithm ("baseline" or "optimized") for a semester.
 * Admin only.
 */
router.post(
  "/run",
  requireRole("admin"),
  validate(runSingleAllocationSchema),
  ctrl.runSingle
);

/**
 * GET /api/v1/allocations/runs/compare?runA=&runB=[&algorithmA=&algorithmB=]
 * Side-by-side comparison of two stored runs (declared before /runs/:runId).
 */
router.get(
  "/runs/compare",
  requireRole("admin", "faculty"),
  validate(compareRunsQuerySchema, "query"),
  ctrl.compareRuns
);

/**
 * GET /api/v1/allocations/runs
 * List all allocation runs.
 */
router.get(
  "/runs",
  requireRole("admin", "faculty"),
  validate(runQuerySchema, "query"),
  ctrl.listRuns
);

/**
 * GET /api/v1/allocations/runs/:runId
 * Get a single allocation run summary.
 */
router.get("/runs/:runId", requireRole("admin", "faculty"), ctrl.getRun);

/**
 * GET /api/v1/allocations/runs/:runId/results
 * Get paginated assignment records for a run.
 */
router.get(
  "/runs/:runId/results",
  requireRole("admin", "faculty"),
  validate(runResultsQuerySchema, "query"),
  ctrl.getRunResults
);

/**
 * POST /api/v1/allocations/runs/:runId/publish
 * Publish a completed run. Admin only.
 *
 * @swagger
 * /api/v1/allocations/runs/{runId}/publish:
 *   post:
 *     summary: Publish an allocation run's results
 *     description: >
 *       Marks the selected algorithm's assignment records as published.
 *       Only the chosen algorithm's Allocation documents are updated; the
 *       other algorithm's results remain available for comparison and audit.
 *       Once published with one algorithm, switching to the other returns 409.
 *       Requires admin role.
 *     tags: [Allocations]
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: runId
 *         required: true
 *         schema:
 *           type: string
 *         description: MongoDB ObjectId of the AllocationRun
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [algorithm]
 *             properties:
 *               algorithm:
 *                 type: string
 *                 enum: [optimized, baseline]
 *                 description: Which algorithm's results to publish
 *           examples:
 *             publishOptimized:
 *               summary: Publish optimized results
 *               value: { "algorithm": "optimized" }
 *             publishBaseline:
 *               summary: Publish baseline results
 *               value: { "algorithm": "baseline" }
 *     responses:
 *       200:
 *         description: Run published successfully
 *       400:
 *         description: Validation error — algorithm field missing or invalid
 *       401:
 *         description: Not authenticated
 *       403:
 *         description: Insufficient role (admin required)
 *       404:
 *         description: Run not found
 *       409:
 *         description: Already published with a different algorithm
 *       422:
 *         description: Constraint violations prevent publication
 */
router.post(
  "/runs/:runId/publish",
  requireRole("admin"),
  validate(publishAllocationSchema),
  ctrl.publishRun
);

export default router;

