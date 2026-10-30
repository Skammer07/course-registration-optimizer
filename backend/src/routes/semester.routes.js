/**
 * src/routes/semester.routes.js
 * Mounted at /api/v1/semesters
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
  createSemesterSchema,
  updateSemesterSchema,
  preferencesStateSchema,
} from "../validators/semester.schema.js";
import * as ctrl from "../controllers/semester.controller.js";

const router = Router();

router.use(requireAuth);

// Status banner data: any logged-in user (students: own semester only, or "me")
router.get("/:semesterId/status", ctrl.status);

router.get("/", requireRole("admin", "faculty"), ctrl.list);
// Which semesters exist and what each holds (admin/faculty: shows counts of students and runs)
router.get("/overview", requireRole("admin", "faculty"), ctrl.overview);
// Demand per course (admin/faculty: reveals how many students ranked what)
router.get("/:semesterId/demand", requireRole("admin", "faculty"), ctrl.demand);
router.post("/", requireRole("admin"), validate(createSemesterSchema), ctrl.create);
router.patch("/:semesterId", requireRole("admin"), validate(updateSemesterSchema), ctrl.update);
router.put(
  "/:semesterId/preferences-state",
  requireRole("admin"),
  validate(preferencesStateSchema),
  ctrl.setPreferencesState
);

export default router;
