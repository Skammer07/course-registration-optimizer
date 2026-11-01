
import { hasTimetableClash, clashesWithFixedSlots } from "../timetable/checkClash.js";

export function validateAllocation({
  students,
  courses,
  preferences,
  allocations,
  timetable = null,
  fixedTimetable = null,
  oneCoursePerGroup = false,
  maxCoursesPerStudent = 2,
}) {
  const errors = [];

  // Validate input structure.
  if (
    !Array.isArray(students) ||
    !Array.isArray(courses) ||
    !Array.isArray(preferences) ||
    !Array.isArray(allocations)
  ) {
    return {
      valid: false,
      errors: ["Students, courses, preferences and allocations must be arrays."],
    };
  }

  const studentById = new Map(students.map((s) => [s.id, s]));
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const courseCounts = new Map();
  const studentCounts = new Map();
  const seenPairs = new Set();
  const studentAllocations = new Map();

  const validPreferences = new Set(
    preferences.map((p) => `${p.studentId}::${p.courseId}`)
  );

  // With elective groups a list belongs to a group, and the same course can be
  // in several groups' lists, so the allocation must name a list it came from.
  const groupOfPreference = (p) => p.electiveGroup ?? courseById.get(p.courseId)?.electiveGroup ?? "";
  const validGroupedPreferences = new Set(
    preferences.map((p) => `${p.studentId}::${p.courseId}::${groupOfPreference(p)}`)
  );

  // Check each allocation.
  for (let i = 0; i < allocations.length; i++) {
    const allocation = allocations[i];
    const label = `Allocation ${i + 1}`;

    if (
      !allocation ||
      typeof allocation.studentId !== "string" ||
      typeof allocation.courseId !== "string"
    ) {
      errors.push(`${label}: missing or invalid studentId/courseId.`);
      continue;
    }

    const { studentId, courseId } = allocation;

    if (!studentById.has(studentId)) {
      errors.push(`${label}: unknown student "${studentId}".`);
    }

    if (!courseById.has(courseId)) {
      errors.push(`${label}: unknown course "${courseId}".`);
    }

    const pairKey = `${studentId}::${courseId}`;

    if (seenPairs.has(pairKey)) {
      errors.push(
        `${label}: duplicate assignment for student "${studentId}" and course "${courseId}".`
      );
    } else {
      seenPairs.add(pairKey);
    }

    const listedInItsGroup =
      oneCoursePerGroup && allocation.electiveGroup
        ? validGroupedPreferences.has(`${pairKey}::${allocation.electiveGroup}`)
        : validPreferences.has(pairKey);

    if (!listedInItsGroup) {
      errors.push(
        `${label}: student "${studentId}" did not select course "${courseId}" in their preferences.`
      );
    }

    courseCounts.set(courseId, (courseCounts.get(courseId) ?? 0) + 1);
    studentCounts.set(studentId, (studentCounts.get(studentId) ?? 0) + 1);

    if (!studentAllocations.has(studentId)) {
      studentAllocations.set(studentId, []);
    }

    studentAllocations.get(studentId).push(allocation);
  }

  // Check course capacities.
  for (const course of courses) {
    const assigned = courseCounts.get(course.id) ?? 0;

    if (!Number.isInteger(course.capacity) || course.capacity < 0) {
      errors.push(`Course "${course.id}" has an invalid capacity.`);
      continue;
    }

    if (assigned > course.capacity) {
      errors.push(
        `Course "${course.id}" exceeds capacity: ${assigned}/${course.capacity}.`
      );
    }
  }

  // Check the maximum courses per student.
  for (const student of students) {
    const assigned = studentCounts.get(student.id) ?? 0;

    if (assigned > maxCoursesPerStudent) {
      errors.push(
        `Student "${student.id}" exceeds the course limit: ${assigned}/${maxCoursesPerStudent}.`
      );
    }
  }

  // Check timetable conflicts.
  if (timetable) {
    for (const [studentId, assignedCourses] of studentAllocations) {
      const student = studentById.get(studentId);
      if (!student) continue;

      for (let i = 0; i < assignedCourses.length; i++) {
        for (let j = i + 1; j < assignedCourses.length; j++) {
          const first = assignedCourses[i];
          const second = assignedCourses[j];

          if (
            courseById.has(first.courseId) &&
            courseById.has(second.courseId) &&
            hasTimetableClash(
              second.courseId,
              [first],
              timetable
            )
          ) {
            errors.push(
              `Student "${studentId}" has a timetable clash between "${first.courseId}" and "${second.courseId}".`
            );
          }
        }
      }
    }
  }

  // At most one course from each elective group.
  if (oneCoursePerGroup) {
    for (const [studentId, assigned] of studentAllocations) {
      const perGroup = new Map();

      for (const allocation of assigned) {
        const group = allocation.electiveGroup ?? courseById.get(allocation.courseId)?.electiveGroup;
        if (!group) continue;
        perGroup.set(group, (perGroup.get(group) ?? 0) + 1);
      }

      for (const [group, count] of perGroup) {
        if (count > 1) {
          errors.push(
            `Student "${studentId}" has ${count} courses in elective group "${group}" (at most one is allowed).`
          );
        }
      }
    }
  }

  // Check clashes with each student's compulsory (fixed) slots.
  if (timetable && fixedTimetable) {
    for (const [studentId, assignedCourses] of studentAllocations) {
      for (const allocation of assignedCourses) {
        if (
          courseById.has(allocation.courseId) &&
          clashesWithFixedSlots(
            allocation.courseId,
            fixedTimetable[studentId],
            timetable
          )
        ) {
          errors.push(
            `Student "${studentId}" has a timetable clash between "${allocation.courseId}" and a compulsory course.`
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
