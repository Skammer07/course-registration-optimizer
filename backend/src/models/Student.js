/**
 * src/models/Student.js
 * Mongoose schema for student records.
 * Mirrors the algorithm's expected { id, name, cgpa } shape,
 * while storing richer institutional data.
 */

import mongoose from "mongoose";

const studentSchema = new mongoose.Schema(
  {
    // Human-readable identifier (e.g. "20JE0001"). Used as "id" in the algorithm.
    studentId: {
      type: String,
      required: [true, "studentId is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    // Cumulative CGPA up to the previous semester, as it stands at pre-registration.
    // This is the value the allocation ranks students by (not the current semester's own average).
    cgpa: {
      type: Number,
      required: [true, "CGPA is required"],
      min: [0, "CGPA cannot be negative"],
      max: [10, "CGPA cannot exceed 10"],
    },
    department: {
      type: String,
      trim: true,
      default: "",
    },
    // The semester the student is currently registered for
    semesterId: {
      type: String,
      trim: true,
      default: "",
    },
    // Elective groups the student belongs to (e.g. ["A", "B"])
    electiveGroups: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

studentSchema.index({ semesterId: 1 });
studentSchema.index({ department: 1 });

export default mongoose.model("Student", studentSchema);
