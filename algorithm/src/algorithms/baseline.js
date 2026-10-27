
export function allocateMeritPhase(
  { students, courses, preferences },
  options = {}
) {
  const meritRatio = options.meritRatio ?? 0.75;

  if (meritRatio <= 0 || meritRatio > 1) {
    throw new Error("meritRatio must be greater than 0 and at most 1");
  }

  const studentById = new Map(students.map(s => [s.id, s]));
  const courseById = new Map(courses.map(c => [c.id, c]));

  for (const course of courses) {
    if (!Number.isInteger(course.capacity) || course.capacity < 0) {
      throw new Error(`Invalid capacity for course ${course.id}`);
    }
  }

  const preferencesByStudent = new Map(
    students.map(s => [s.id, []])
  );

  for (const p of preferences) {
    if (!studentById.has(p.studentId) || !courseById.has(p.courseId)) {
      throw new Error(`Invalid preference for student ${p.studentId}`);
    }

    preferencesByStudent.get(p.studentId).push(p);
  }

  for (const list of preferencesByStudent.values()) {
    list.sort((a, b) => a.rank - b.rank);
  }

  const ordered = [...students].sort(
    (a, b) => b.cgpa - a.cgpa || a.id.localeCompare(b.id)
  );

  const quota = new Map(
    courses.map(c => [c.id, Math.floor(c.capacity * meritRatio)])
  );

  const allocatedCount = new Map(courses.map(c => [c.id, 0]));
  const allocations = [];
  const allocatedStudents = new Set();


  // Process each student in merit order.
  // If a student fills a course's quota, also consider the remaining
  // students tied at that CGPA for the same course.
  for (let i = 0; i < ordered.length; i++) {
    const student = ordered[i];

    if (allocatedStudents.has(student.id)) continue;

    for (const p of preferencesByStudent.get(student.id)) {
      const course = courseById.get(p.courseId);
      const used = allocatedCount.get(course.id);
      const limit = quota.get(course.id);

      if (used >= limit) continue;

      if (
        options.canEnroll &&
        !options.canEnroll(student, course, allocations)
      ) {
        continue;
      }

      allocations.push({
        studentId: student.id,
        courseId: course.id,
        preferenceRank: p.rank,
        phase: "merit",
      });

      allocatedStudents.add(student.id);
      allocatedCount.set(course.id, used + 1);

      // If this allocation fills the quota, include the rest of
      // the same-CGPA group who prefer this course.
      if (used + 1 === limit) {
        let j = i + 1;

        while (
          j < ordered.length &&
          ordered[j].cgpa === student.cgpa
        ) {
          const tiedStudent = ordered[j];

          if (!allocatedStudents.has(tiedStudent.id)) {
            const tiedPreference = preferencesByStudent
              .get(tiedStudent.id)
              .find(pref => pref.courseId === course.id);

            if (
              tiedPreference &&
              (!options.canEnroll ||
                options.canEnroll(tiedStudent, course, allocations))
            ) {
              allocations.push({
                studentId: tiedStudent.id,
                courseId: course.id,
                preferenceRank: tiedPreference.rank,
                phase: "merit",
              });

              allocatedStudents.add(tiedStudent.id);
              allocatedCount.set(
                course.id,
                allocatedCount.get(course.id) + 1
              );
            }
          }

          j++;
        }
      }

      break;
    }
  }

  return {
    allocations,
    unallocatedStudentIds: students
      .filter(s => !allocatedStudents.has(s.id))
      .map(s => s.id),

    courseSummary: courses.map(c => ({
      courseId: c.id,
      capacity: c.capacity,
      meritQuota: quota.get(c.id),
      meritAllocated: allocatedCount.get(c.id),
      totalSeatsRemaining: c.capacity - allocatedCount.get(c.id),
    })),

    assumptions: {
      meritRatio,
      maxCoursesPerStudentInMeritPhase: 1,
      tieHandling: "include tied students when quota is reached",
    },
  };
}
