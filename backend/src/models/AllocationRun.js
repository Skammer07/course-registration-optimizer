/**
 * src/models/AllocationRun.js
 * Stores metadata, configuration, and summary for each allocation run.
 * Large per-assignment records live in the Allocation collection.
 *
 * REPRODUCIBILITY:
 *   inputSnapshot stores the full normalized algorithm inputs (students,
 *   courses, preferences, timetable) so the run can be reproduced exactly
 *   even after later edits to Student/Course/Preference documents.
 *
 * PUBLISH:
 *   selectedAlgorithm records which algorithm's results the admin chose
 *   to publish. Only that algorithm's Allocation documents are set to
 *   "published"; the other remains "proposed" for audit.
 */

import mongoose from "mongoose";

const metricsSchema = new mongoose.Schema(
  {
    totalStudents: Number,
    totalCourses: Number,
    totalAssignments: Number,
    assignmentsWithPreferences: Number,
    rank2Assignments: Number,
    invalidAssignments: Number,
    studentsWithAtLeastOneCourse: Number,
    studentsWithTwoCourses: Number,
    unallocatedStudents: Number,
    totalCapacity: Number,
    capacityUtilization: Number,
    rank1Assignments: Number,
    averagePreferenceRank: Number,
    capacityViolations: Number,
    studentLimitViolations: Number,
    duplicateAssignments: Number,
    timetableClashes: Number,
    constraintViolations: Number,
  },
  { _id: false }
);

const validationSummarySchema = new mongoose.Schema(
  {
    valid: Boolean,
    errorCount: Number,
    // Store error list but cap it to prevent enormous docs
    errorList: { type: [String], default: [] },
  },
  { _id: false }
);

/**
 * Normalized student/course/preference records stored for reproducibility.
 * These are the exact inputs passed to the algorithm, not live DB documents.
 */
const inputSnapshotSchema = new mongoose.Schema(
  {
    studentCount: Number,
    courseCount: Number,
    preferenceCount: Number,
    timetableIncluded: Boolean,
    // Full immutable copies of the normalized algorithm inputs
    students: { type: [mongoose.Schema.Types.Mixed], default: null },
    courses: { type: [mongoose.Schema.Types.Mixed], default: null },
    preferences: { type: [mongoose.Schema.Types.Mixed], default: null },
    timetable: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const allocationRunSchema = new mongoose.Schema(
  {
    semesterId: {
      type: String,
      required: [true, "semesterId is required"],
      trim: true,
    },
    status: {
      type: String,
      enum: {
        // "publishing" is the short-lived claimed state of the publication
        // state machine: completed -> publishing -> published (or back to
        // completed if finalization fails).
        values: ["pending", "running", "completed", "failed", "publishing", "published"],
        message: "Invalid status",
      },
      default: "pending",
    },
    algorithmVersion: {
      type: String,
      default: "1.0.0",
    },
    // Seed of the baseline lottery; with the same snapshot + algorithmVersion
    // it reproduces the same baseline result.
    randomSeed: { type: Number, default: null },
    // Which algorithm(s) this run contains. Runs created before this field
    // existed (and /compare runs) contain both.
    algorithmsRun: {
      type: [{ type: String, enum: ["baseline", "optimized"] }],
      default: ["baseline", "optimized"],
    },
    // SHA-256 of the normalized input; equal fingerprints = same input data,
    // so two runs can be compared fairly.
    inputFingerprint: { type: String, default: null },
    configuration: {
      maxCoursesPerStudent: { type: Number, default: 2 },
      // null for optimizer-only runs (ratios do not apply to the optimizer)
      meritRatio: { type: Number, default: 0.75 },
      randomRatio: { type: Number, default: 0.25 },
      timetableValidationEnabled: { type: Boolean, default: false },
    },
    // Summary metrics for each algorithm variant
    baselineMetrics: { type: metricsSchema, default: null },
    optimizedMetrics: { type: metricsSchema, default: null },
    baselineValidation: { type: validationSummarySchema, default: null },
    optimizedValidation: { type: validationSummarySchema, default: null },
    comparison: {
      improvement: { type: mongoose.Schema.Types.Mixed, default: null },
      validComparison: { type: Boolean, default: null },
      note: { type: String, default: null },
    },
    // Runtime information
    baselineRuntimeMs: { type: Number, default: null },
    optimizedRuntimeMs: { type: Number, default: null },
    totalRuntimeMs: { type: Number, default: null },
    // Full normalized input snapshot for reproducibility
    inputSnapshot: { type: inputSnapshotSchema, default: null },
    // Outcome of the last pre-publication re-validation of the actual stored
    // assignments (not the cached metrics above).
    publicationCheck: {
      type: new mongoose.Schema(
        {
          algorithm: { type: String, enum: ["baseline", "optimized"] },
          valid: Boolean,
          assignmentCount: Number,
          errorCount: Number,
          errorList: { type: [String], default: [] },
          checkedAt: Date,
        },
        { _id: false }
      ),
      default: null,
    },
    // Records excluded before the algorithm ran (inactive students/courses).
    inputWarnings: {
      type: new mongoose.Schema(
        {
          skippedPreferences: Number,
          droppedCourseEntries: Number,
          messages: { type: [String], default: [] },
        },
        { _id: false }
      ),
      default: null,
    },
    // Safe error summary — no stack traces stored
    errorSummary: { type: String, default: null },
    // Which algorithm the admin chose to publish (set at publish time)
    selectedAlgorithm: {
      type: String,
      enum: { values: ["baseline", "optimized"], message: "Invalid algorithm" },
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

allocationRunSchema.index({ semesterId: 1, status: 1 });
allocationRunSchema.index({ createdAt: -1 });

export default mongoose.model("AllocationRun", allocationRunSchema);

