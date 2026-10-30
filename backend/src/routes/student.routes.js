/**
 * src/routes/student.routes.js
 *
 * Authorization matrix:
 *   GET  /             admin, faculty only  (list all students)
 *   GET  /:id          admin, faculty, OR the student who owns the record
 *   POST /             admin, faculty only
 *   PATCH /:id         admin, faculty only
 *   DELETE /:id        admin only
 *
 * Students cannot list other students or modify any student record.
 * Ownership for GET /:id is enforced inside the controller using req.user.
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
  createStudentSchema,
  updateStudentSchema,
  studentQuerySchema,
} from "../validators/student.schema.js";
import * as ctrl from "../controllers/student.controller.js";

const router = Router();

// All student routes require authentication
router.use(requireAuth);

// List — admin and faculty only; students must not enumerate all records
router.get("/", requireRole("admin", "faculty"), validate(studentQuerySchema, "query"), ctrl.list);

// Get one — admin/faculty always; student can only access their own record (ownership check in controller)
router.get("/:id", ctrl.getOne);

router.post(
  "/",
  requireRole("admin", "faculty"),
  validate(createStudentSchema),
  ctrl.create
);

router.patch(
  "/:id",
  requireRole("admin", "faculty"),
  validate(updateStudentSchema),
  ctrl.update
);

router.delete("/:id", requireRole("admin"), ctrl.deactivate);

export default router;

