/**
 * Calculate allocation quality metrics.
 *
 * Expected allocation record:
 * { studentId, courseId, phase?, iteration? }
 *
 * Timetable format:
 * {
 *   C1: [{ day: "Monday", start: "09:00", end: "09:50" }],
 *   C2: [{ day: "Monday", start: "10:00", end: "10:50" }]
 * }
 */

function timeToMinutes(time) {
  if (typeof time !== "string" || !/^\d{2}:\d{2}$/.test(time)) {
    return NaN;
  }

  const [hours, minutes] = time.split(":").map(Number);

  if (hours > 23 || minutes > 59) {
    return NaN;
  }

  return hours * 60 + minutes;
}

function coursesOverlap(courseA, courseB, timetable) {
  const slotsA = timetable?.[courseA] ?? [];
  const slotsB = timetable?.[courseB] ?? [];

  for (const a of slotsA) {
    for (const b of slotsB) {
      if (a.day !== b.day) continue;

      const aStart = timeToMinutes(a.start);
      const aEnd = timeToMinutes(a.end);
      const bStart = timeToMinutes(b.start);
      const bEnd = timeToMinutes(b.end);

      if (
        ![aStart, aEnd, bStart, bEnd].every(Number.isFinite) ||
        aStart >= aEnd ||
        bStart >= bEnd
      ) {
        continue;
      }

      if (aStart < bEnd && bStart < aEnd) {
        return true;
      }
    }
  }

  return false;
}

export function calculateMetrics({
  students = [],
  courses = [],
  preferences = [],
  allocations = [],
  timetable,
  maxCoursesPerStudent = 2,
} = {}) {
  const studentById = new Map(students.map((s) => [s.id, s]));
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const preferenceRank = new Map(
    preferences.map((p) => [`${p.studentId}::${p.courseId}`, p.rank])
  );

  const studentCounts = new Map();
  const courseCounts = new Map();
  const seenPairs = new Set();

  let duplicateAssignments = 0;
  let invalidAssignments = 0;
  let assignmentsWithPreferences = 0;
  let rankSum = 0;
  let rank1Assignments = 0;
  let rank2Assignments = 0;

  for (const allocation of allocations) {
    const { studentId, courseId } = allocation ?? {};
    const student = studentById.get(studentId);
    const course = courseById.get(courseId);

    if (!student || !course) {
      invalidAssignments++;
      continue;
    }

    const pair = `${studentId}::${courseId}`;

    if (seenPairs.has(pair)) {
      duplicateAssignments++;
    } else {
      seenPairs.add(pair);
    }

    studentCounts.set(
      studentId,
      (studentCounts.get(studentId) ?? 0) + 1
    );

    courseCounts.set(
      courseId,
      (courseCounts.get(courseId) ?? 0) + 1
    );

    const rank = preferenceRank.get(pair);

    if (rank !== undefined) {
      assignmentsWithPreferences++;
      rankSum += rank;

      if (rank === 1) rank1Assignments++;
      if (rank === 2) rank2Assignments++;
    }
  }

  let capacityViolations = 0;

  for (const course of courses) {
    if ((courseCounts.get(course.id) ?? 0) > course.capacity) {
      capacityViolations++;
    }
  }

  let studentLimitViolations = 0;
  let studentsWithTwoCourses = 0;
  let studentsWithAtLeastOneCourse = 0;

  for (const student of students) {
    const count = studentCounts.get(student.id) ?? 0;

    if (count > maxCoursesPerStudent) {
      studentLimitViolations++;
    }

    if (count >= 1) studentsWithAtLeastOneCourse++;
    if (count === 2) studentsWithTwoCourses++;
  }

  let timetableClashes = 0;

  if (timetable) {
    const coursesByStudent = new Map();

    for (const allocation of allocations) {
      if (
        !studentById.has(allocation.studentId) ||
        !courseById.has(allocation.courseId)
      ) {
        continue;
      }

      if (!coursesByStudent.has(allocation.studentId)) {
        coursesByStudent.set(allocation.studentId, []);
      }

      coursesByStudent.get(allocation.studentId).push(allocation.courseId);
    }

    for (const assignedCourses of coursesByStudent.values()) {
      for (let i = 0; i < assignedCourses.length; i++) {
        for (let j = i + 1; j < assignedCourses.length; j++) {
          if (
            coursesOverlap(
              assignedCourses[i],
              assignedCourses[j],
              timetable
            )
          ) {
            timetableClashes++;
          }
        }
      }
    }
  }

  const unallocatedStudents = students.filter(
    (student) => (studentCounts.get(student.id) ?? 0) === 0
  ).length;

  const totalCapacity = courses.reduce(
    (sum, course) => sum + course.capacity,
    0
  );

  return {
    totalStudents: students.length,
    totalCourses: courses.length,
    totalAssignments: allocations.length,
    studentsWithAtLeastOneCourse,
    studentsWithTwoCourses,
    unallocatedStudents,
    totalCapacity,
    capacityUtilization:
      totalCapacity === 0
        ? 0
        : Number(((allocations.length / totalCapacity) * 100).toFixed(2)),
    assignmentsWithPreferences,
    rank1Assignments,
    rank2Assignments,
    averagePreferenceRank:
      assignmentsWithPreferences === 0
        ? null
        : Number(
            (rankSum / assignmentsWithPreferences).toFixed(2)
          ),
    capacityViolations,
    studentLimitViolations,
    duplicateAssignments,
    invalidAssignments,
    timetableClashes,
    constraintViolations:
      capacityViolations +
      studentLimitViolations +
      duplicateAssignments +
      invalidAssignments +
      timetableClashes,
  };
}