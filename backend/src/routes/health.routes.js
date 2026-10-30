/**
 * src/routes/health.routes.js
 */

import { Router } from "express";
import { getDbStatus } from "../config/db.js";
import { getActiveRunCount, getAlgorithmInfo } from "../services/allocationEngine.service.js";

const router = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Application health check
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 *       503:
 *         description: Database unavailable
 */
router.get("/", async (_req, res) => {
  const dbStatus = getDbStatus();
  const algorithm = await getAlgorithmInfo();
  const healthy = dbStatus === "connected" && algorithm.available;

  return res.status(healthy ? 200 : 503).json({
    success: healthy,
    status: healthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    services: {
      database: dbStatus,
      algorithm: algorithm.available ? "available" : "unavailable",
    },
    algorithmVersion: algorithm.version,
    activeRuns: getActiveRunCount(),
  });
});

export default router;

