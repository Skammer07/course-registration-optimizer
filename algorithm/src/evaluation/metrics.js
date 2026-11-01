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
  fixedTimetable = null,
  oneCoursePerGroup = false,
  maxCoursesPerStudent = 2,
} = {}) {
  const studentById = new Map(students.map((s) => [s.id, s]));
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const preferenceRank = new Map(
    preferences.map((p) => [`${p.studentId}::${p.courseId}`, p.rank])
  );

  // The same course can be in the lists of two elective groups, so an
  // allocation that names its group is ranked by that group's list.
  const groupOfPreference = (p) => p.electiveGroup ?? courseById.get(p.courseId)?.electiveGroup ?? "";
  const rankInGroup = new Map(
    preferences.map((p) => [`${p.studentId}::${p.courseId}::${groupOfPreference(p)}`, p.rank])
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

    const rank =
      (allocation.electiveGroup
        ? rankInGroup.get(`${pair}::${allocation.electiveGroup}`)
        : undefined) ?? preferenceRank.get(pair);

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

  // Clashes with a student's compulsory (fixed) slots count as timetable clashes.
  if (timetable && fixedTimetable) {
    for (const allocation of allocations) {
      const fixedSlots = fixedTimetable[allocation.studentId];
      const slots = timetable[allocation.courseId] ?? [];

      if (!Array.isArray(fixedSlots)) continue;

      const clash = slots.some(slot =>
        fixedSlots.some(fixed => {
          if (slot.day !== fixed.day) return false;
          const slotStart = timeToMinutes(slot.start);
          const slotEnd = timeToMinutes(slot.end);
          const fixedStart = timeToMinutes(fixed.start);
          const fixedEnd = timeToMinutes(fixed.end);
          return slotStart < fixedEnd && fixedStart < slotEnd;
        })
      );

      if (clash) timetableClashes++;
    }
  }

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

  // Elective groups: more than one course in a group is a violation, and a
  // student who ranked a group but got nothing from it is "missing" that group.
  let groupLimitViolations = 0;
  let studentsMissingAGroup = 0;

  if (oneCoursePerGroup) {
    const groupOf = new Map(courses.map((c) => [c.id, c.electiveGroup ?? null]));
    const held = new Map();
    const ranked = new Map();

    for (const allocation of allocations) {
      const group = allocation.electiveGroup ?? groupOf.get(allocation.courseId);
      if (!group) continue;
      const mine = held.get(allocation.studentId) ?? new Map();
      mine.set(group, (mine.get(group) ?? 0) + 1);
      held.set(allocation.studentId, mine);
    }

    for (const p of preferences) {
      const group = groupOfPreference(p);
      if (!group) continue;
      if (!ranked.has(p.studentId)) ranked.set(p.studentId, new Set());
      ranked.get(p.studentId).add(group);
    }

    for (const student of students) {
      const mine = held.get(student.id) ?? new Map();
      let missing = false;

      for (const group of ranked.get(student.id) ?? []) {
        if ((mine.get(group) ?? 0) === 0) missing = true;
      }

      for (const count of mine.values()) {
        if (count > 1) groupLimitViolations += count - 1;
      }

      if (missing) studentsMissingAGroup++;
    }
  }

  // CGPA priority. A violation is a student who ranked a course above the one
  // they received in that group (or received nothing there), where that course
  // went to a student with a LOWER CGPA, and the student could have taken it
  // (they do not hold it already, and it does not clash with their other
  // courses or their compulsory classes). Zero means CGPA order was respected.
  let cgpaPriorityViolations = 0;

  if (oneCoursePerGroup) {
    const groupOf = new Map(courses.map((c) => [c.id, c.electiveGroup ?? null]));
    const slotOfAllocation = (a) => a.electiveGroup ?? groupOf.get(a.courseId) ?? "";
    const slotOfPreference = (p) => p.electiveGroup ?? groupOf.get(p.courseId) ?? "";

    const holders = new Map();
    const heldByStudent = new Map();

    for (const a of allocations) {
      if (!holders.has(a.courseId)) holders.set(a.courseId, new Set());
      holders.get(a.courseId).add(a.studentId);
      if (!heldByStudent.has(a.studentId)) heldByStudent.set(a.studentId, []);
      heldByStudent.get(a.studentId).push(a);
    }

    const slotsOverlap = (slotsA, slotsB) =>
      (slotsA ?? []).some((x) =>
        (slotsB ?? []).some((y) => {
          if (x.day !== y.day) return false;
          return timeToMinutes(x.start) < timeToMinutes(y.end) &&
            timeToMinutes(y.start) < timeToMinutes(x.end);
        })
      );

    const canTake = (student, courseId, slot) => {
      const held = heldByStudent.get(student.id) ?? [];

      if (held.some((a) => a.courseId === courseId)) return false;

      if (timetable) {
        const slots = timetable[courseId];

        if (fixedTimetable && slotsOverlap(slots, fixedTimetable[student.id])) return false;

        // the course in this very slot would be replaced, so it does not count
        for (const a of held) {
          if (slotOfAllocation(a) === slot) continue;
          if (slotsOverlap(slots, timetable[a.courseId])) return false;
        }
      }

      return true;
    };

    const bySlot = new Map();

    for (const p of preferences) {
      const key = `${p.studentId}::${slotOfPreference(p)}`;
      if (!bySlot.has(key)) bySlot.set(key, []);
      bySlot.get(key).push(p);
    }

    for (const list of bySlot.values()) {
      const student = studentById.get(list[0].studentId);
      if (!student) continue;

      const slot = slotOfPreference(list[0]);
      const given = (heldByStudent.get(student.id) ?? []).find((a) => slotOfAllocation(a) === slot);
      const givenRank = given
        ? list.find((p) => p.courseId === given.courseId)?.rank ?? Infinity
        : Infinity;

      for (const p of list) {
        if (p.rank >= givenRank) continue;

        const wasGivenTo = holders.get(p.courseId);
        if (!wasGivenTo) continue;

        const lowerCgpaHolds = [...wasGivenTo].some((id) => {
          const other = studentById.get(id);
          return other && other.id !== student.id && other.cgpa < student.cgpa;
        });

        if (lowerCgpaHolds && canTake(student, p.courseId, slot)) cgpaPriorityViolations++;
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
    groupLimitViolations,
    studentsMissingAGroup,
    cgpaPriorityViolations,
    constraintViolations:
      capacityViolations +
      studentLimitViolations +
      duplicateAssignments +
      invalidAssignments +
      timetableClashes +
      groupLimitViolations,
  };
}