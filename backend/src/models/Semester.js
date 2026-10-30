/**
 * src/models/Semester.js
 * Per-semester preference window. A semester WITHOUT a record behaves as
 * "preferences open", so existing data keeps working unchanged.
 *
 * Open/closed is decided by:
 *   1. preferencesOverride ("open" | "closed") when an admin set it manually;
 *   2. otherwise the preferencesOpenAt / preferencesCloseAt dates
 *      (a missing bound means unbounded on that side).
 * Publishing a run closes preferences (override "closed").
 */

import mongoose from "mongoose";

const semesterSchema = new mongoose.Schema(
  {
    semesterId: {
      type: String,
      required: [true, "semesterId is required"],
      unique: true,
      trim: true,
    },
    name: { type: String, trim: true, default: "" },
    preferencesOpenAt: { type: Date, default: null },
    preferencesCloseAt: { type: Date, default: null },
    preferencesOverride: {
      type: String,
      enum: { values: ["open", "closed", null], message: "Invalid override" },
      default: null,
    },
  },
  { timestamps: true }
);

semesterSchema.pre("validate", function () {
  if (
    this.preferencesOpenAt &&
    this.preferencesCloseAt &&
    this.preferencesCloseAt <= this.preferencesOpenAt
  ) {
    this.invalidate("preferencesCloseAt", "preferencesCloseAt must be after preferencesOpenAt");
  }
});

export default mongoose.model("Semester", semesterSchema);
