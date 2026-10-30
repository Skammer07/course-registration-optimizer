
export function allocateMeritPhase(
  { students, courses, preferences },
  options = {}
) {
  const meritRatio = options.meritRatio ?? 0.75;
  const maxCoursesPerStudent = options.maxCoursesPerStudent ?? 2;

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

    const pairKey =
      `${preference.studentId}:${preference.courseId}`;

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
      Math.floor(course.capacity * meritRatio)
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
  function assign(student, course, preference, iteration) {
    allocations.push({
      studentId: student.id,
      courseId: course.id,
      preferenceRank: preference.rank,
      phase: "merit",
      iteration
    });

    allocatedPairs.add(`${student.id}:${course.id}`);

    meritAllocatedCount.set(
      course.id,
      meritAllocatedCount.get(course.id) + 1
    );

    studentCourseCount.set(
      student.id,
      studentCourseCount.get(student.id) + 1
    );
  }

  // 9. Run two merit iterations.
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
      meritIterations: 2,
      maxCoursesPerStudent,
      quotaSharedAcrossIterations: true,
      tieHandling:
        "Include tied students when quota is reached, subject to total capacity"
    }
  };
}
