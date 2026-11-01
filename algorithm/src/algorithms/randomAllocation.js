
/**
 * Random allocation phase.
 *
 * Rules:
 * - Each course has a separate random quota.
 * - Students are randomly selected from each course's preference list.
 * - A student can receive at most maxCoursesPerStudent across all phases.
 * - A student cannot receive the same course twice.
 * - Total course capacity can never be exceeded.
 * - Timetable clashes are checked against all previous allocations.
 * - Unused merit seats do not increase the random quota.
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
  const randomRatio = options.randomRatio ?? 0.3;
  const oneCoursePerGroup = options.oneCoursePerGroup ?? true;
  const maxCoursesPerStudent = options.maxCoursesPerStudent ?? 2;
  const random = options.random ?? Math.random;
  const canEnroll = options.canEnroll;

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

  if (canEnroll !== undefined && typeof canEnroll !== "function") {
    throw new Error("canEnroll must be a function");
  }

  const studentById = new Map(students.map(s => [s.id, s]));
  const courseById = new Map(courses.map(c => [c.id, c]));

  // Elective groups: a preference list belongs to a group, a course may be in
  // several groups' lists, and a student gets at most one course per group.
  const courseGroup = new Map(courses.map(c => [c.id, c.electiveGroup ?? null]));
  const prefGroup = p => p.electiveGroup ?? courseGroup.get(p.courseId) ?? null;
  const groupNames = [
    ...new Set(preferences.map(prefGroup).filter(Boolean))
  ].sort();
  const useGroups = oneCoursePerGroup && groupNames.length > 0;
  const slots = useGroups
    ? [
        ...groupNames,
        ...(preferences.some(p => !prefGroup(p)) ? [""] : [])
      ]
    : [];
  const slotOf = p => prefGroup(p) ?? "";

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

    const key =
      `${preference.studentId}::${preference.courseId}` +
      (useGroups ? `::${slotOf(preference)}` : "");

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

  // Include allocations from earlier phases.
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
    if (studentCourseCount.get(student.id) > maxCoursesPerStudent) {
      throw new Error(
        `Existing allocations exceed course limit for student ${student.id}`
      );
    }
  }

  // Students already holding a course of a group (from the merit phase) are
  // not drawn again for that group.
  const heldGroups = new Set();

  if (useGroups) {
    for (const allocation of existingAllocations) {
      const group = allocation.electiveGroup ?? courseGroup.get(allocation.courseId) ?? "";
      heldGroups.add(`${allocation.studentId}::${group}`);
    }
  }

  // Calculate the fixed random quota for each course.
  const randomQuota = new Map(
    courses.map(course => [
      course.id,
      // whatever the rounded merit share leaves, so no seat is lost to rounding
      course.capacity - Math.round(course.capacity * (1 - randomRatio) + 1e-9),
    ])
  );

  const randomAllocatedCount = new Map(
    courses.map(course => [course.id, 0])
  );

  const allocations = [];
  const allSoFar = [...existingAllocations];

  const record = (studentId, courseId, rank, slot) => {
    const allocation = { studentId, courseId, preferenceRank: rank, phase: "random" };

    if (useGroups && slot) allocation.electiveGroup = slot;

    allocations.push(allocation);
    allSoFar.push(allocation);
    studentCoursePairs.add(`${studentId}::${courseId}`);
    studentCourseCount.set(studentId, studentCourseCount.get(studentId) + 1);
    courseTotalCount.set(courseId, courseTotalCount.get(courseId) + 1);
    randomAllocatedCount.set(courseId, randomAllocatedCount.get(courseId) + 1);

    if (useGroups) heldGroups.add(`${studentId}::${slot}`);
  };

  // With groups: one draw per group. Students still without a course of the
  // group are put in a random order and each takes the best-ranked course of
  // that group's list that still has a lottery seat, so a student is never given
  // a low choice while a higher choice of theirs had a free seat. The same
  // course may be in several groups' lists; a student never gets it twice.
  if (useGroups) {
    const listsByStudent = new Map(students.map(s => [s.id, []]));

    for (const list of preferencesByCourse.values()) {
      for (const p of list) listsByStudent.get(p.studentId).push(p);
    }

    for (const list of listsByStudent.values()) {
      list.sort((a, b) => a.rank - b.rank || a.courseId.localeCompare(b.courseId));
    }

    for (const slot of slots) {
      const interested = students.filter(
        s =>
          !heldGroups.has(`${s.id}::${slot}`) &&
          listsByStudent.get(s.id).some(p => slotOf(p) === slot)
      );

      for (let i = interested.length - 1; i > 0; i--) {
        const value = random();

        if (!Number.isFinite(value) || value < 0 || value >= 1) {
          throw new Error("random must return a number in [0, 1)");
        }

        const j = Math.floor(value * (i + 1));
        [interested[i], interested[j]] = [interested[j], interested[i]];
      }

      for (const student of interested) {
        if (studentCourseCount.get(student.id) >= maxCoursesPerStudent) continue;

        for (const preference of listsByStudent.get(student.id)) {
          if (slotOf(preference) !== slot) continue;

          const courseId = preference.courseId;
          const course = courseById.get(courseId);

          if (randomAllocatedCount.get(courseId) >= randomQuota.get(courseId)) continue;
          if (courseTotalCount.get(courseId) >= course.capacity) continue;
          if (studentCoursePairs.has(`${student.id}::${courseId}`)) continue;
          if (canEnroll && !canEnroll(student, course, allSoFar)) continue;

          record(student.id, courseId, preference.rank, slot);
          break;
        }
      }
    }
  }

  // Without groups: each course draws among the students who ranked it.
  for (const course of useGroups ? [] : courses) {
    const courseId = course.id;
    const quota = randomQuota.get(courseId);

    if (quota === 0) continue;

    const candidates = [...preferencesByCourse.get(courseId)];

    // Fisher-Yates shuffle.
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
      if (randomAllocatedCount.get(courseId) >= quota) {
        break;
      }

      const studentId = preference.studentId;
      const pairKey = `${studentId}::${courseId}`;

      if (studentCoursePairs.has(pairKey)) continue;

      if (
        studentCourseCount.get(studentId) >= maxCoursesPerStudent
      ) {
        continue;
      }

      if (courseTotalCount.get(courseId) >= course.capacity) {
        break;
      }

      // Check timetable compatibility against merit allocations
      // and random allocations already made in this phase.
      if (canEnroll) {
        const allocationsSoFar = [
          ...existingAllocations,
          ...allocations,
        ];

        const student = studentById.get(studentId);

        if (!canEnroll(student, course, allocationsSoFar)) {
          continue;
        }
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
      selectionMethod: useGroups
        ? "random order of students within each elective group; each takes their best-ranked course that still has a lottery seat"
        : "random shuffle within each course",
      oneCoursePerGroup: useGroups,
      unusedMeritSeatsTransferred: false,
      timetableValidationEnabled: Boolean(canEnroll),
    },
  };
}
