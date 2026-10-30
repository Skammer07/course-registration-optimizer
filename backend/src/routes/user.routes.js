/**
 * src/routes/user.routes.js
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { createUserSchema } from "../validators/user.schema.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { created } from "../utils/respond.js";
import * as userService from "../services/user.service.js";

const router = Router();

router.use(requireAuth);

/**
 * @openapi
 * /api/v1/users:
 *   post:
 *     summary: Create a login account (admin only)
 *     description: >
 *       Students must be linked to an existing Student record via studentId.
 *       There is no public signup.
 *     tags: [Users]
 *     security: [{ cookieAuth: [] }]
 *     responses:
 *       201: { description: User created }
 *       400: { description: Validation error or unknown studentId }
 *       403: { description: Admin only }
 *       409: { description: Email already used, or the student already has a login }
 */
router.post(
  "/",
  requireRole("admin"),
  validate(createUserSchema),
  asyncHandler(async (req, res) => {
    const user = await userService.createUser(req.body);
    return created(res, { user }, "User created");
  })
);

export default router;
