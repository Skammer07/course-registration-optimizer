/**
 * src/routes/course.routes.js
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
  createCourseSchema,
  updateCourseSchema,
  courseQuerySchema,
} from "../validators/course.schema.js";
import * as ctrl from "../controllers/course.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/", validate(courseQuerySchema, "query"), ctrl.list);

// A student's own compulsory courses (declared before /:id so it is not read as an id)
router.get("/my-compulsory", requireRole("student"), ctrl.myCompulsory);

router.get("/:id", ctrl.getOne);

router.post(
  "/",
  requireRole("admin", "faculty"),
  validate(createCourseSchema),
  ctrl.create
);

router.patch(
  "/:id",
  requireRole("admin", "faculty"),
  validate(updateCourseSchema),
  ctrl.update
);

router.delete("/:id", requireRole("admin"), ctrl.deactivate);

export default router;

