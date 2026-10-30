/**
 * src/routes/health.routes.js
 */

import { Router } from "express";
import { getDbStatus } from "../config/db.js";

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
router.get("/", (_req, res) => {
  const dbStatus = getDbStatus();
  const healthy = dbStatus === "connected";

  return res.status(healthy ? 200 : 503).json({
    success: healthy,
    status: healthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    services: {
      database: dbStatus,
    },
  });
});

export default router;

