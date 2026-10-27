
/**
 * Random allocation phase.
 *
 * Rules:
 * - Each course has a separate random quota.
 * - Students are randomly selected from each course's preference list.
 * - A student can receive at most maxCoursesPerStudent across all phases.
 * - A student cannot receive the same course twice.
 * - Total course capacity can never be exceeded.
 * - Unused merit seats do not increase the random quota.
 *
 * Input:
 * {
 *   students: [{ id, cgpa }],
 *   courses: [{ id, capacity }],
 *   preferences: [{ studentId, courseId, rank }],
 *   existingAllocations: [
 *     { studentId, courseId, phase }
 *   ]
 * }
 */
export function allocateRandomPhase(
  {
    students,
    courses,
    preferences,
    existingAllocations = [],
  },
  options = {}
) {
  const randomRatio = options.randomRatio ?? 0.25;
  const maxCoursesPerStudent = options.maxCoursesPerStudent ?? 2;
  const random = options.random ?? Math.random;

  if (
    !Number.isFinite(randomRatio) ||
    randomRatio < 0 ||
    randomRatio > 1
  ) {
    throw new Error("randomRatio must be between 0 and 1");
  }

  if (
    !Number.isInteger(maxCoursesPerStudent) ||
    maxCoursesPerStudent < 1
  ) {
    throw new Error("maxCoursesPerStudent must be a positive integer");
  }

  if (typeof random !== "function") {
    throw new Error("random must be a function");
  }

  const studentById = new Map(students.map(s => [s.id, s]));
  const courseById = new Map(courses.map(c => [c.id, c]));

  for (const student of students) {
    if (!Number.isFinite(student.cgpa)) {
      throw new Error(`Invalid CGPA for student ${student.id}`);
    }
  }

  for (const course of courses) {
    if (!Number.isInteger(course.capacity) || course.capacity < 0) {
      throw new Error(`Invalid capacity for course ${course.id}`);
    }
  }

  // Validate preferences and group them by course.
  const preferencesByCourse = new Map(
    courses.map(course => [course.id, []])
  );

  const seenPreferences = new Set();

  for (const preference of preferences) {
    if (
      !studentById.has(preference.studentId) ||
      !courseById.has(preference.courseId)
    ) {
      throw new Error(
        `Invalid preference for student ${preference.studentId}`
      );
    }

    const key = `${preference.studentId}::${preference.courseId}`;

    // Avoid adding the same student to a course list more than once.
    if (seenPreferences.has(key)) continue;
    seenPreferences.add(key);

    preferencesByCourse.get(preference.courseId).push(preference);
  }

  const courseTotalCount = new Map(
    courses.map(course => [course.id, 0])
  );

  const studentCourseCount = new Map(
    students.map(student => [student.id, 0])
  );

  const studentCoursePairs = new Set();

  // Count allocations made in earlier phases.
  for (const allocation of existingAllocations) {
    if (
      !studentById.has(allocation.studentId) ||
      !courseById.has(allocation.courseId)
    ) {
      throw new Error(
        `Invalid existing allocation for student ${allocation.studentId}`
      );
    }

    const key = `${allocation.studentId}::${allocation.courseId}`;

    if (studentCoursePairs.has(key)) {
      throw new Error(
        `Duplicate course allocation for student ${allocation.studentId}`
      );
    }

    studentCoursePairs.add(key);

    studentCourseCount.set(
      allocation.studentId,
      studentCourseCount.get(allocation.studentId) + 1
    );

    courseTotalCount.set(
      allocation.courseId,
      courseTotalCount.get(allocation.courseId) + 1
    );
  }

  for (const course of courses) {
    if (courseTotalCount.get(course.id) > course.capacity) {
      throw new Error(
        `Existing allocations exceed capacity for course ${course.id}`
      );
    }
  }

  for (const student of students) {
    if (
      studentCourseCount.get(student.id) > maxCoursesPerStudent
    ) {
      throw new Error(
        `Existing allocations exceed course limit for student ${student.id}`
      );
    }
  }

  // Each course gets a fixed random quota.
  // Unused merit seats are not transferred here.
  const randomQuota = new Map(
    courses.map(course => [
      course.id,
      Math.floor(course.capacity * randomRatio),
    ])
  );

  const randomAllocatedCount = new Map(
    courses.map(course => [course.id, 0])
  );

  const allocations = [];

  // Process each course's student list separately.
  // Course order is the order supplied in the input.
  for (const course of courses) {
    const courseId = course.id;
    const quota = randomQuota.get(courseId);

    if (quota === 0) continue;

    const candidates = [...preferencesByCourse.get(courseId)];

    // Fisher-Yates shuffle using the injectable random generator.
    for (let i = candidates.length - 1; i > 0; i--) {
      const value = random();

      if (!Number.isFinite(value) || value < 0 || value >= 1) {
        throw new Error("random must return a number in [0, 1)");
      }

      const j = Math.floor(value * (i + 1));

      [candidates[i], candidates[j]] = [
        candidates[j],
        candidates[i],
      ];
    }

    for (const preference of candidates) {
      // Stop once this course's random quota is filled.
      if (randomAllocatedCount.get(courseId) >= quota) {
        break;
      }

      const studentId = preference.studentId;
      const pairKey = `${studentId}::${courseId}`;

      // Student must not already have this course.
      if (studentCoursePairs.has(pairKey)) continue;

      // Respect the limit across all phases.
      if (
        studentCourseCount.get(studentId) >= maxCoursesPerStudent
      ) {
        continue;
      }

      // Never exceed total course capacity.
      if (courseTotalCount.get(courseId) >= course.capacity) {
        break;
      }

      allocations.push({
        studentId,
        courseId,
        preferenceRank: preference.rank,
        phase: "random",
      });

      studentCoursePairs.add(pairKey);

      studentCourseCount.set(
        studentId,
        studentCourseCount.get(studentId) + 1
      );

      courseTotalCount.set(
        courseId,
        courseTotalCount.get(courseId) + 1
      );

      randomAllocatedCount.set(
        courseId,
        randomAllocatedCount.get(courseId) + 1
      );
    }
  }

  const allAllocations = [
    ...existingAllocations,
    ...allocations,
  ];

  return {
    allocations,
    allAllocations,

    unallocatedStudentIds: students
      .filter(student => studentCourseCount.get(student.id) === 0)
      .map(student => student.id),

    studentSummary: students.map(student => ({
      studentId: student.id,
      coursesAllocated: studentCourseCount.get(student.id),
      coursesRemaining: Math.max(
        0,
        maxCoursesPerStudent - studentCourseCount.get(student.id)
      ),
    })),

    courseSummary: courses.map(course => ({
      courseId: course.id,
      capacity: course.capacity,
      randomQuota: randomQuota.get(course.id),
      randomAllocated: randomAllocatedCount.get(course.id),
      totalAllocated: courseTotalCount.get(course.id),
      totalSeatsRemaining:
        course.capacity - courseTotalCount.get(course.id),
    })),

    assumptions: {
      randomRatio,
      maxCoursesPerStudent,
      selectionMethod: "random shuffle within each course",
      unusedMeritSeatsTransferred: false,
    },
  };
}
