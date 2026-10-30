/**
 * src/models/Preference.js
 * Mongoose schema for a student's ranked course preferences.
 * 
 * The algorithm expects flat { studentId, courseId, rank } records.
 * This model stores grouped preferences (per elective group) and the
 * backend converts them to the flat format before calling the algorithm.
 */

import mongoose from "mongoose";

const preferenceSchema = new mongoose.Schema(
  {
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: [true, "Student reference is required"],
    },
    semesterId: {
      type: String,
      required: [true, "semesterId is required"],
      trim: true,
    },
    // Elective group (e.g. "A", "B")
    electiveGroup: {
      type: String,
      required: [true, "electiveGroup is required"],
      trim: true,
    },
    // Ordered list of course ObjectIds (index 0 = rank 1, index 1 = rank 2, …)
    rankedCourseIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Course" }],
      required: [true, "rankedCourseIds is required"],
      validate: [
        {
          validator(arr) {
            if (!arr || arr.length === 0) return false;
            // No duplicate course IDs
            const ids = arr.map((id) => id.toString());
            return ids.length === new Set(ids).size;
          },
          message: "rankedCourseIds must be non-empty and contain no duplicates",
        },
      ],
    },
    status: {
      type: String,
      enum: { values: ["draft", "submitted"], message: "Status must be draft or submitted" },
      default: "draft",
    },
    submittedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// One preference list per student per semester per elective group
preferenceSchema.index(
  { student: 1, semesterId: 1, electiveGroup: 1 },
  { unique: true }
);

export default mongoose.model("Preference", preferenceSchema);

