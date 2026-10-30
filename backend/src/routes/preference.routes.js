/**
 * src/routes/preference.routes.js
 */

import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
  upsertPreferenceSchema,
  preferenceQuerySchema,
  preferenceOverviewQuerySchema,
} from "../validators/preference.schema.js";
import * as ctrl from "../controllers/preference.controller.js";

const router = Router();

router.use(requireAuth);

// Student: get/update own preferences
router.get(
  "/me",
  requireRole("student"),
  validate(preferenceQuerySchema, "query"),
  ctrl.getMyPreferences
);
router.put("/me", requireRole("student"), validate(upsertPreferenceSchema), ctrl.upsertMyPreference);

// Admin/faculty: read all preferences
router.get(
  "/",
  requireRole("admin", "faculty"),
  validate(preferenceQuerySchema, "query"),
  ctrl.listAll
);

// Who has submitted, drafted or not started (must stay above "/:id")
router.get(
  "/overview",
  requireRole("admin", "faculty"),
  validate(preferenceOverviewQuerySchema, "query"),
  ctrl.overview
);

router.get("/:id", requireRole("admin", "faculty"), ctrl.getOne);

export default router;

