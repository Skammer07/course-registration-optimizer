/**
 * src/routes/auth.routes.js
 */

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { login, logout, me } from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { loginSchema } from "../validators/auth.schema.js";
import { env } from "../config/env.js";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: env.rateLimitLoginWindowMs,
  max: env.rateLimitLoginMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "RATE_LIMITED",
      message: "Too many login attempts. Please try again later.",
      details: [],
    },
  },
  // NOTE: In-memory rate limiting. Not effective across multiple Node.js instances.
  // For multi-instance deployments, use a shared store (e.g. Redis).
});

/**
 * @openapi
 * /api/v1/auth/login:
 *   post:
 *     summary: Login with email and password
 *     tags: [Auth]
 */
router.post("/login", loginLimiter, validate(loginSchema), login);

/**
 * @openapi
 * /api/v1/auth/logout:
 *   post:
 *     summary: Clear the authentication cookie
 *     tags: [Auth]
 */
router.post("/logout", logout);

/**
 * @openapi
 * /api/v1/auth/me:
 *   get:
 *     summary: Get current authenticated user
 *     tags: [Auth]
 *     security:
 *       - cookieAuth: []
 */
router.get("/me", requireAuth, me);

export default router;

