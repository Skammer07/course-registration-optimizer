/**
 * src/routes/import.routes.js
 * Mounted at /api/v1/imports. Admin only. The CSV is the request body
 * (Content-Type: text/csv), at most 2 MB.
 */

import express, { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import { importQuerySchema } from "../validators/import.schema.js";
import * as ctrl from "../controllers/import.controller.js";

const router = Router();

router.use(requireAuth);
router.use(requireRole("admin"));

const csvBody = express.text({ type: ["text/csv", "text/plain", "application/csv"], limit: "2mb" });

/**
 * @swagger
 * /api/v1/imports/students:
 *   post:
 *     summary: Import students from CSV (columns studentId,name,cgpa[,department,semesterId,electiveGroups,isActive,email])
 *     tags: [Imports]
 */
router.post("/students", csvBody, validate(importQuerySchema, "query"), ctrl.students);

/**
 * @swagger
 * /api/v1/imports/courses:
 *   post:
 *     summary: Import courses from CSV (columns courseCode,title,capacity,semesterId,electiveGroup[,timetable,isActive])
 *     tags: [Imports]
 */
router.post("/courses", csvBody, validate(importQuerySchema, "query"), ctrl.courses);

/**
 * @swagger
 * /api/v1/imports/preferences:
 *   post:
 *     summary: Import preference lists from CSV (one row per ranked course; columns studentId,semesterId,electiveGroup,courseCode,rank)
 *     tags: [Imports]
 */
router.post("/preferences", csvBody, validate(importQuerySchema, "query"), ctrl.preferences);

export default router;
