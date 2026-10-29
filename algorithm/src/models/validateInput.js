/**
 * Validate the input data used by the course allocation algorithms.
 *
 * Expected input:
 * {
 *   students: [{ id, name, cgpa }],
 *   courses: [{ id, name, capacity }],
 *   preferences: [{ studentId, courseId, rank }]
 * }
 *
 * Returns { valid, errors }.
 */
export function validateInput({ students, courses, preferences } = {}) {
  const errors = [];

  if (!Array.isArray(students)) {
    errors.push("students must be an array");
  }

  if (!Array.isArray(courses)) {
    errors.push("courses must be an array");
  }

  if (!Array.isArray(preferences)) {
    errors.push("preferences must be an array");
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const studentIds = new Set();
  const courseIds = new Set();
  const preferencePairs = new Set();

  for (const student of students) {
    if (!student || typeof student.id !== "string" || !student.id.trim()) {
      errors.push("Every student must have a non-empty string id");
      continue;
    }

    if (studentIds.has(student.id)) {
      errors.push(`Duplicate student id: ${student.id}`);
    }

    studentIds.add(student.id);

    if (!Number.isFinite(student.cgpa)) {
      errors.push(`Student ${student.id} must have a numeric cgpa`);
    }
  }

  for (const course of courses) {
    if (!course || typeof course.id !== "string" || !course.id.trim()) {
      errors.push("Every course must have a non-empty string id");
      continue;
    }

    if (courseIds.has(course.id)) {
      errors.push(`Duplicate course id: ${course.id}`);
    }

    courseIds.add(course.id);

    if (!Number.isInteger(course.capacity) || course.capacity < 0) {
      errors.push(
        `Course ${course.id} must have a non-negative integer capacity`
      );
    }
  }

  for (const preference of preferences) {
    if (!preference) {
      errors.push("Preference records cannot be empty");
      continue;
    }

    const { studentId, courseId, rank } = preference;

    if (!studentIds.has(studentId)) {
      errors.push(
        `Preference references unknown student: ${studentId}`
      );
    }

    if (!courseIds.has(courseId)) {
      errors.push(
        `Preference references unknown course: ${courseId}`
      );
    }

    if (!Number.isInteger(rank) || rank < 1) {
      errors.push(
        `Preference rank must be a positive integer for ${studentId}/${courseId}`
      );
    }

    const pair = `${studentId}::${courseId}`;

    if (preferencePairs.has(pair)) {
      errors.push(
        `Duplicate preference for student ${studentId} and course ${courseId}`
      );
    }

    preferencePairs.add(pair);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}