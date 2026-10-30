/**
 * src/models/Course.js
 * Mongoose schema for course records.
 * Mirrors algorithm's { id, name, capacity } shape.
 */

import mongoose from "mongoose";
import { WEEKDAYS, isValidTime, isValidSlot } from "../utils/timetable.js";

const timetableSlotSchema = new mongoose.Schema(
  {
    day: {
      type: String,
      required: true,
      enum: WEEKDAYS,
    },
    start: {
      type: String,
      required: true,
      match: [/^\d{2}:\d{2}$/, "Start time must be HH:MM"],
      validate: {
        validator: isValidTime,
        message: "Start time must have a valid hour (00-23) and minute (00-59)",
      },
    },
    end: {
      type: String,
      required: true,
      match: [/^\d{2}:\d{2}$/, "End time must be HH:MM"],
      validate: {
        validator: isValidTime,
        message: "End time must have a valid hour (00-23) and minute (00-59)",
      },
    },
  },
  { _id: false }
);

const courseSchema = new mongoose.Schema(
  {
    // Human-readable code used as "id" in the algorithm (e.g. "CS301")
    courseCode: {
      type: String,
      required: [true, "courseCode is required"],
      trim: true,
      uppercase: true,
    },
    title: {
      type: String,
      required: [true, "Title is required"],
      trim: true,
    },
    capacity: {
      type: Number,
      required: [true, "Capacity is required"],
      min: [0, "Capacity cannot be negative"],
      validate: {
        validator: Number.isInteger,
        message: "Capacity must be a non-negative integer",
      },
    },
    semesterId: {
      type: String,
      required: [true, "semesterId is required"],
      trim: true,
    },
    // Elective group (e.g. "A", "B", or null for compulsory)
    electiveGroup: {
      type: String,
      trim: true,
      default: null,
    },
    // Timetable slots for clash detection
    timetableSlots: {
      type: [timetableSlotSchema],
      default: [],
      // Array-level validator: also runs for findByIdAndUpdate(runValidators)
      // and checks the cross-field rule (start strictly before end).
      validate: {
        validator: (slots) => (slots ?? []).every(isValidSlot),
        message: "Every timetable slot needs a valid weekday, valid HH:MM times, and start earlier than end",
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Unique per course code within a semester
courseSchema.index({ courseCode: 1, semesterId: 1 }, { unique: true });
courseSchema.index({ semesterId: 1, electiveGroup: 1 });

export default mongoose.model("Course", courseSchema);

