/**
 * src/models/Allocation.js
 * Stores per-assignment records for a completed allocation run.
 * Linked to AllocationRun by runId.
 *
 * preferenceRank:
 *   - 1-based rank when the student listed this course in their preferences.
 *   - null when the algorithm assigned a course outside the preference list
 *     (e.g. compulsory courses or unmatched capacity fills in future rules).
 *   - The min constraint (1) only applies when a value is present.
 *
 * status:
 *   - "proposed" — computed but not publicly visible to students.
 *   - "published" — admin selected this algorithm's results for publication.
 *     Only the SELECTED algorithm's Allocation documents become "published";
 *     the other algorithm's remain "proposed" for audit.
 */

import mongoose from "mongoose";

const allocationSchema = new mongoose.Schema(
  {
    run: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AllocationRun",
      required: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    // Which algorithm produced this assignment
    algorithm: {
      type: String,
      enum: { values: ["baseline", "optimized"], message: "Invalid algorithm" },
      required: true,
    },
    // 1-based rank from the student's submitted preference list, or null
    preferenceRank: {
      type: Number,
      default: null,
      validate: {
        validator(v) {
          // Must be null or a positive integer
          return v === null || (Number.isInteger(v) && v >= 1);
        },
        message: "preferenceRank must be null or a positive integer >= 1",
      },
    },
    // phase metadata from the baseline pipeline (e.g. "merit", "random")
    phase: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: { values: ["proposed", "published"], message: "Invalid status" },
      default: "proposed",
    },
  },
  { timestamps: true }
);

// Prevent duplicate student-course assignment for the same run+algorithm
allocationSchema.index(
  { run: 1, student: 1, course: 1, algorithm: 1 },
  { unique: true }
);
allocationSchema.index({ run: 1, algorithm: 1 });
allocationSchema.index({ student: 1, status: 1 });

export default mongoose.model("Allocation", allocationSchema);


