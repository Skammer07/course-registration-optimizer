
function toMinutes(time) {
  if (typeof time !== "string") {
    throw new Error(`Invalid timetable time: ${time}`);
  }

  const match = time.match(/^(\d{2}):(\d{2})$/);

  if (!match) {
    throw new Error(`Invalid timetable time: ${time}`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) {
    throw new Error(`Invalid timetable time: ${time}`);
  }

  return hours * 60 + minutes;
}

function intervalsOverlap(slotA, slotB) {
  const startA = toMinutes(slotA.start);
  const endA = toMinutes(slotA.end);
  const startB = toMinutes(slotB.start);
  const endB = toMinutes(slotB.end);

  if (startA >= endA || startB >= endB) {
    throw new Error("A timetable slot must end after it starts");
  }

  // Adjacent classes do not clash.
  return startA < endB && startB < endA;
}

function sameDay(dayA, dayB) {
  return String(dayA).trim().toLowerCase() ===
    String(dayB).trim().toLowerCase();
}

/**
 * Returns true if the proposed course overlaps with
 * any course already allocated to this student.
 *
 * timetable format:
 * {
 *   C1: [{ day: "Monday", start: "09:00", end: "09:50" }],
 *   C2: [{ day: "Monday", start: "09:00", end: "09:50" }]
 * }
 */
export function hasTimetableClash(
  proposedCourseId,
  existingAllocations,
  timetable
) {
  const proposedSlots = timetable[proposedCourseId];

  if (!Array.isArray(proposedSlots) || proposedSlots.length === 0) {
    throw new Error(
      `Missing timetable slots for course ${proposedCourseId}`
    );
  }

  const existingCourseIds = new Set(
    existingAllocations.map(allocation => allocation.courseId)
  );

  for (const existingCourseId of existingCourseIds) {
    if (existingCourseId === proposedCourseId) {
      continue;
    }

    const existingSlots = timetable[existingCourseId];

    if (!Array.isArray(existingSlots) || existingSlots.length === 0) {
      throw new Error(
        `Missing timetable slots for course ${existingCourseId}`
      );
    }

    for (const proposedSlot of proposedSlots) {
      for (const existingSlot of existingSlots) {
        if (
          sameDay(proposedSlot.day, existingSlot.day) &&
          intervalsOverlap(proposedSlot, existingSlot)
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Adapter for the allocation algorithms' canEnroll hook.
 * It checks only the proposed student's existing allocations.
 */
export function createTimetableCanEnroll(timetable) {
  return (student, course, allocations) => {
    const studentAllocations = allocations.filter(
      allocation => allocation.studentId === student.id
    );

    return !hasTimetableClash(
      course.id,
      studentAllocations,
      timetable
    );
  };
}
