/**
 * src/models/User.js
 * Mongoose schema for system users (students, faculty, admins).
 * Passwords are NEVER stored in plaintext.
 */

import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Invalid email address"],
    },
    passwordHash: {
      type: String,
      required: [true, "Password hash is required"],
      select: false, // Never returned in queries by default
    },
    role: {
      type: String,
      enum: {
        values: ["student", "faculty", "admin"],
        message: "Role must be student, faculty, or admin",
      },
      required: [true, "Role is required"],
    },
    // Reference to Student document (only for role === "student")
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    // Never serialize passwordHash to JSON
    toJSON: {
      transform(_doc, ret) {
        delete ret.passwordHash;
        return ret;
      },
    },
  }
);

// Login lookups use the unique index created by `unique: true` on `email`;
// declaring a second index on the same field only triggers a Mongoose warning.

export default mongoose.model("User", userSchema);

