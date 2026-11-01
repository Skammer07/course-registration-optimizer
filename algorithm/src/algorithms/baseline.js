
export function allocateMeritPhase(
  { students, courses, preferences },
  options = {}
) {
  const meritRatio = options.meritRatio ?? 0.7;
  const maxCoursesPerStudent = options.maxCoursesPerStudent ?? 2;
  const oneCoursePerGroup = options.oneCoursePerGroup ?? true;

  // 1. Validate input
  if (
    !Array.isArray(students) ||
    !Array.isArray(courses) ||
    !Array.isArray(preferences)
  ) {
    throw new Error(
      "Input must contain students, courses, and preferences arrays"
    );
  }

  if (
    !Number.isFinite(meritRatio) ||
    meritRatio < 0 ||
    meritRatio > 1
  ) {
    // 0 is valid: no merit seats, every seat is left to the random phase.
    throw new Error(
      "meritRatio must be between 0 and 1 (inclusive)"
    );
  }

  if (
    !Number.isInteger(maxCoursesPerStudent) ||
    maxCoursesPerStudent < 1
  ) {
    throw new Error(
      "maxCoursesPerStudent must be a positive integer"
    );
  }

  // 2. Validate students
  const studentById = new Map();

  for (const student of students) {
    if (
      !student.id ||
      !Number.isFinite(student.cgpa) ||
      student.cgpa < 0
    ) {
      throw new Error(
        `Invalid student: ${student.id ?? "unknown"}`
      );
    }

    if (studentById.has(student.id)) {
      throw new Error(`Duplicate student ID: ${student.id}`);
    }

    studentById.set(student.id, student);
  }

  // 3. Validate courses
  const courseById = new Map();

  for (const course of courses) {
    if (!course.id || courseById.has(course.id)) {
      throw new Error(
        `Invalid or duplicate course ID: ${course.id}`
      );
    }

    if (
      !Number.isInteger(course.capacity) ||
      course.capacity < 0
    ) {
      throw new Error(
        `Invalid capacity for course ${course.id}`
      );
    }

    courseById.set(course.id, course);
  }

  // 4. Group preferences by student
  const preferencesByStudent = new Map(
    students.map(student => [student.id, []])
  );

  const seenPreferences = new Set();

  for (const preference of preferences) {
    if (
      !studentById.has(preference.studentId) ||
      !courseById.has(preference.courseId) ||
      !Number.isInteger(preference.rank) ||
      preference.rank < 1
    ) {
      throw new Error(
        `Invalid preference for student ${preference.studentId}`
      );
    }

    // With elective groups the same course may appear once in each group's list.
    const pairKey =
      `${preference.studentId}:${preference.courseId}` +
      (oneCoursePerGroup ? `:${preference.electiveGroup ?? ""}` : "");

    if (seenPreferences.has(pairKey)) {
      throw new Error(
        `Duplicate student-course preference: ${pairKey}`
      );
    }

    seenPreferences.add(pairKey);

    preferencesByStudent
      .get(preference.studentId)
      .push(preference);
  }

  for (const list of preferencesByStudent.values()) {
    list.sort((a, b) => a.rank - b.rank);
  }

  // 5. Sort students by descending CGPA.
  // Student ID provides deterministic ordering for equal CGPAs.
  const ordered = [...students].sort(
    (a, b) =>
      b.cgpa - a.cgpa ||
      a.id.localeCompare(b.id)
  );

  // 6. Establish ONE shared merit quota per course.
  // This quota is shared by both merit iterations.
  const meritQuota = new Map(
    courses.map(course => [
      course.id,
      // rounded, so the lottery gets exactly the remaining seats and none is lost
      Math.round(course.capacity * meritRatio + 1e-9)
    ])
  );

  const meritAllocatedCount = new Map(
    courses.map(course => [course.id, 0])
  );

  const studentCourseCount = new Map(
    students.map(student => [student.id, 0])
  );

  const allocations = [];

  // Prevent a student from receiving the same course twice.
  const allocatedPairs = new Set();

  // Elective groups. A preference list belongs to a group (OE1, OE2, ...). Each
  // group is an independent priority list and a course may appear in several
  // groups' lists (all groups can draw from the same pool). A student holds at
  // most one course per group and never the same course twice. With groups the
  // merit phase serves students strictly in CGPA order: each student in turn
  // takes the best available course of every group's list, so CGPA priority
  // holds across the whole pool. Without groups (or with oneCoursePerGroup
  // false) the original two iterations over all preferences are used.
  const courseGroup = new Map(courses.map(c => [c.id, c.electiveGroup ?? null]));
  const prefGroup = p => p.electiveGroup ?? courseGroup.get(p.courseId) ?? null;
  const groupNames = [
    ...new Set(preferences.map(prefGroup).filter(Boolean))
  ].sort();
  const useGroups = oneCoursePerGroup && groupNames.length > 0;

  // one slot per group; preferences with no group share one extra slot
  const slots = useGroups
    ? [
        ...groupNames,
        ...(preferences.some(p => !prefGroup(p)) ? [""] : [])
      ]
    : [];
  const heldGroups = new Set();

  // 7. Check whether a proposed allocation is allowed.
  function canReceive(student, course) {
    const pairKey = `${student.id}:${course.id}`;

    if (allocatedPairs.has(pairKey)) {
      return false;
    }

    if (
      studentCourseCount.get(student.id) >=
      maxCoursesPerStudent
    ) {
      return false;
    }

    if (
      meritAllocatedCount.get(course.id) >=
      meritQuota.get(course.id)
    ) {
      return false;
    }

    // Keep the existing hook for timetable and other constraints.
    if (
      options.canEnroll &&
      !options.canEnroll(student, course, allocations)
    ) {
      return false;
    }

    return true;
  }

  // 8. Record a merit allocation.
  function assign(student, course, preference, iteration, group) {
    const allocation = {
      studentId: student.id,
      courseId: course.id,
      preferenceRank: preference.rank,
      phase: "merit",
      iteration
    };

    if (useGroups && group) {
      allocation.electiveGroup = group;
    }

    allocations.push(allocation);

    allocatedPairs.add(`${student.id}:${course.id}`);

    if (useGroups) {
      heldGroups.add(`${student.id}::${group ?? ""}`);
    }

    meritAllocatedCount.set(
      course.id,
      meritAllocatedCount.get(course.id) + 1
    );

    studentCourseCount.set(
      student.id,
      studentCourseCount.get(student.id) + 1
    );
  }

  const courseTotal = course =>
    allocations.filter(a => a.courseId === course.id).length;

  if (useGroups) {
    // 9a. Students in CGPA order; each takes the best course of every group.
    const courseCapacity = new Map(courses.map(c => [c.id, c.capacity]));

    for (let i = 0; i < ordered.length; i++) {
      const student = ordered[i];

      for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
        const slot = slots[slotIndex];

        if (
          studentCourseCount.get(student.id) >=
          maxCoursesPerStudent
        ) {
          break;
        }

        // already given a course of this group (as part of a CGPA tie)
        if (heldGroups.has(`${student.id}::${slot}`)) {
          continue;
        }

        for (const preference of preferencesByStudent.get(student.id)) {
          if ((prefGroup(preference) ?? "") !== slot) {
            continue;
          }

          const course = courseById.get(preference.courseId);

          if (!canReceive(student, course)) {
            continue;
          }

          assign(student, course, preference, slotIndex + 1, slot);

          // When the last merit seat of a course is taken, students tied at
          // this CGPA who ranked it are admitted too (within real capacity).
          if (
            meritAllocatedCount.get(course.id) ===
            meritQuota.get(course.id)
          ) {
            for (
              let j = i + 1;
              j < ordered.length && ordered[j].cgpa === student.cgpa;
              j++
            ) {
              const tied = ordered[j];

              if (
                studentCourseCount.get(tied.id) >= maxCoursesPerStudent ||
                allocatedPairs.has(`${tied.id}:${course.id}`) ||
                courseCapacity.get(course.id) <= courseTotal(course) ||
                (options.canEnroll &&
                  !options.canEnroll(tied, course, allocations))
              ) {
                continue;
              }

              // the best-ranked list of theirs that has this course and no
              // course of that group yet
              const tiedPreference = preferencesByStudent
                .get(tied.id)
                .find(
                  p =>
                    p.courseId === course.id &&
                    !heldGroups.has(`${tied.id}::${prefGroup(p) ?? ""}`)
                );

              if (tiedPreference) {
                const tiedSlot = prefGroup(tiedPreference) ?? "";

                assign(
                  tied,
                  course,
                  tiedPreference,
                  slots.indexOf(tiedSlot) + 1,
                  tiedSlot
                );
              }
            }
          }

          break;
        }
      }
    }
  } else {
    // 9b. Two iterations over all preferences (no elective groups).
    for (let iteration = 1; iteration <= 2; iteration++) {
      // Each student may receive at most one course per iteration.
      const assignedThisIteration = new Set();

      for (let i = 0; i < ordered.length; i++) {
        const student = ordered[i];

        if (assignedThisIteration.has(student.id)) {
          continue;
        }

        if (
          studentCourseCount.get(student.id) >=
          maxCoursesPerStudent
        ) {
          continue;
        }

        // Try preferences in rank order.
        for (const preference of preferencesByStudent.get(student.id)) {
          const course = courseById.get(preference.courseId);

          if (!canReceive(student, course)) {
            continue;
          }

          assign(student, course, preference, iteration);
          assignedThisIteration.add(student.id);

          // If the allocation reaches the merit quota,
          // include remaining students tied at this CGPA
          // who prefer the same course.
          if (
            meritAllocatedCount.get(course.id) ===
            meritQuota.get(course.id)
          ) {
            let j = i + 1;

            while (
              j < ordered.length &&
              ordered[j].cgpa === student.cgpa
            ) {
              const tiedStudent = ordered[j];

              if (
                !assignedThisIteration.has(tiedStudent.id) &&
                studentCourseCount.get(tiedStudent.id) <
                  maxCoursesPerStudent
              ) {
                const tiedPreference = preferencesByStudent
                  .get(tiedStudent.id)
                  .find(
                    p => p.courseId === course.id
                  );

                const pairKey =
                  `${tiedStudent.id}:${course.id}`;

                const hasTotalCapacity =
                  // The merit quota may be exceeded for a tie,
                  // but the physical course capacity may not.
                  courses.find(c => c.id === course.id).capacity >
                  allocations.filter(
                    a => a.courseId === course.id
                  ).length;

                const canEnroll =
                  !options.canEnroll ||
                  options.canEnroll(
                    tiedStudent,
                    course,
                    allocations
                  );

                if (
                  tiedPreference &&
                  !allocatedPairs.has(pairKey) &&
                  hasTotalCapacity &&
                  canEnroll
                ) {
                  assign(
                    tiedStudent,
                    course,
                    tiedPreference,
                    iteration
                  );

                  assignedThisIteration.add(tiedStudent.id);
                }
              }

              j++;
            }
          }

          // Move to the next student after assigning one course.
          break;
        }
      }
    }
  }

  // 10. Return allocations and summaries.
  return {
    allocations,

    unallocatedStudentIds: students
      .filter(
        student =>
          studentCourseCount.get(student.id) === 0
      )
      .map(student => student.id),

    courseSummary: courses.map(course => ({
      courseId: course.id,
      capacity: course.capacity,
      meritQuota: meritQuota.get(course.id),
      meritAllocated: meritAllocatedCount.get(course.id),
      totalSeatsRemaining:
        course.capacity -
        allocations.filter(
          allocation => allocation.courseId === course.id
        ).length
    })),

    studentSummary: students.map(student => ({
      studentId: student.id,
      coursesAllocated: studentCourseCount.get(student.id)
    })),

    assumptions: {
      meritRatio,
      meritIterations: useGroups ? slots.length : 2,
      oneCoursePerGroup: useGroups,
      maxCoursesPerStudent,
      quotaSharedAcrossIterations: true,
      tieHandling:
        "Include tied students when quota is reached, subject to total capacity"
    }
  };
}
