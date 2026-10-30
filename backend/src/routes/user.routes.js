/**
 * src/routes/user.routes.js
 * Mounted at /api/v1/users. Admin only.
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { createUserSchema, listUsersQuerySchema, setUserStatusSchema } from "../validators/user.schema.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { success, created } from "../utils/respond.js";
import * as userService from "../services/user.service.js";

const router = Router();

router.use(requireAuth);
router.use(requireRole("admin"));

// Responses that carry a temporary password must never be cached.
const noStore = (res) => res.set("Cache-Control", "no-store");

/**
 * @swagger
 * /api/v1/users:
 *   post:
 *     summary: Create a login (admin). Omit "password" to get a one-time temporary password.
 *     tags: [Users]
 */
router.post(
  "/",
  validate(createUserSchema),
  asyncHandler(async (req, res) => {
    const result = await userService.createUser(req.body);
    noStore(res);
    return created(res, result, "User created");
  })
);

router.get(
  "/",
  validate(listUsersQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const result = await userService.listUsers(req.query);
    return success(res, result, "Users retrieved");
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = await userService.getUserById(req.params.id);
    return success(res, { user }, "User retrieved");
  })
);

router.patch(
  "/:id/status",
  validate(setUserStatusSchema),
  asyncHandler(async (req, res) => {
    const user = await userService.setUserActive(req.params.id, req.body.isActive, req.user._id);
    return success(res, { user }, req.body.isActive ? "User activated" : "User deactivated");
  })
);

router.post(
  "/:id/reset-password",
  asyncHandler(async (req, res) => {
    const result = await userService.resetUserPassword(req.params.id, req.user._id);
    noStore(res);
    return success(res, result, "Password reset; share the temporary password securely");
  })
);

export default router;
