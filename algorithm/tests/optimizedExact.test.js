import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";

import { allocateOptimized } from "../src/algorithms/optimizedAllocation.js";
import { validateAllocation } from "../src/validation/validateAllocation.js";
import { createSeededRandom } from "../src/utils/seededRandom.js";
import { generateDataset } from "../../backend/src/seed/generateDataset.js";

const SLOTS = [
  { day: "Monday", start: "09:00", end: "09:50" },
  { day: "Monday", start: "09:30", end: "10:20" },
  { day: "Tuesday", start: "09:00", end: "09:50" },
  { day: "Wednesday", start: "11:00", end: "11:50" },
];

function randomInstance(seed) {
  const random = createSeededRandom(seed);
  const int = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));

  const students = Array.from({ length: int(2, 4) }, (_, i) => ({
    id: `S${i + 1}`,
    cgpa: 6 + random() * 4,
  }));

  const courses = Array.from({ length: int(2, 4) }, (_, i) => ({
    id: `C${i + 1}`,
    capacity: int(1, 2),
  }));

  const timetable = {};
  for (const c of courses) timetable[c.id] = [SLOTS[int(0, SLOTS.length - 1)]];

  const preferences = [];
  for (const s of students) {
    const order = courses.map((c) => c.id).sort(() => random() - 0.5);
    order.slice(0, int(1, courses.length)).forEach((courseId, i) =>
      preferences.push({ studentId: s.id, courseId, rank: i + 1 })
    );
  }

  // Some students also have a compulsory class in one of the slots.
  const fixedTimetable = {};
  for (const s of students) {
    if (random() < 0.5) fixedTimetable[s.id] = [SLOTS[int(0, SLOTS.length - 1)]];
  }

  return { students, courses, preferences, timetable, fixedTimetable };
}

/** Exhaustive search: most assignments, then lowest rank cost. */
function bruteForce({ courses, preferences, timetable, fixedTimetable }, maxCourses) {
  const clash = (a, b) =>
    allocateClash(timetable[a][0], timetable[b][0]);

  let best = null;

  function visit(index, chosen, seatsLeft) {
    if (index === preferences.length) {
      const flow = chosen.length;
      const cost = chosen.reduce((sum, p) => sum + p.rank - 1, 0);

      if (!best || flow > best.flow || (flow === best.flow && cost < best.cost)) {
        best = { flow, cost };
      }
      return;
    }

    visit(index + 1, chosen, seatsLeft);

    const p = preferences[index];

    // A course overlapping the student's compulsory class is not allowed.
    if ((fixedTimetable[p.studentId] ?? []).some((f) => allocateClash(timetable[p.courseId][0], f))) {
      return;
    }
    const mine = chosen.filter((c) => c.studentId === p.studentId);

    if (
      seatsLeft.get(p.courseId) > 0 &&
      mine.length < maxCourses &&
      !mine.some((c) => clash(c.courseId, p.courseId))
    ) {
      seatsLeft.set(p.courseId, seatsLeft.get(p.courseId) - 1);
      visit(index + 1, [...chosen, p], seatsLeft);
      seatsLeft.set(p.courseId, seatsLeft.get(p.courseId) + 1);
    }
  }

  visit(0, [], new Map(courses.map((c) => [c.id, c.capacity])));
  return best;
}

function allocateClash(a, b) {
  const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  return (
    a.day === b.day &&
    minutes(a.start) < minutes(b.end) &&
    minutes(b.start) < minutes(a.end)
  );
}

describe("optimizer is exact with timetable clashes", () => {
  it("matches an exhaustive search on 150 small random instances (with compulsory slots)", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const instance = randomInstance(seed);
      const maxCoursesPerStudent = 2;

      const result = allocateOptimized(instance, {
        maxCoursesPerStudent,
        timetable: instance.timetable,
        fixedTimetable: instance.fixedTimetable,
      });

      const expected = bruteForce(instance, maxCoursesPerStudent);

      expect(
        { flow: result.totalAllocated, cost: result.totalPreferenceCost },
        `seed ${seed}`
      ).toEqual(expected);

      expect(
        validateAllocation({
          ...instance,
          allocations: result.allocations,
          maxCoursesPerStudent,
        }).valid,
        `seed ${seed} validity`
      ).toBe(true);
    }
  });

  it("is deterministic for identical input", () => {
    const instance = randomInstance(42);
    const options = {
      maxCoursesPerStudent: 2,
      timetable: instance.timetable,
      fixedTimetable: instance.fixedTimetable,
    };

    expect(allocateOptimized(instance, options).allocations).toEqual(
      allocateOptimized(instance, options).allocations
    );
  });
});

describe("optimizer output is pinned on generated clash-heavy data", () => {
  // Fingerprint recorded from the implementation before the search was
  // reordered and pruned by cost, so a speed-up must not change the result.
  it("many-clashes, 60 students, seed 2", () => {
    const ds = generateDataset({ scenario: "many-clashes", size: 60, seed: 2 });

    const timetable = {};
    for (const c of ds.courses) timetable[c.courseCode] = c.timetableSlots;

    const preferences = ds.preferences.flatMap((p) =>
      p.courseCodes.map((code, i) => ({
        studentId: p.studentId,
        courseId: code,
        rank: i + 1,
      }))
    );

    const result = allocateOptimized(
      {
        students: ds.students.map((s) => ({ id: s.studentId, cgpa: s.cgpa })),
        courses: ds.courses.map((c) => ({ id: c.courseCode, capacity: c.capacity })),
        preferences,
      },
      { maxCoursesPerStudent: 2, timetable }
    );

    const pairs = result.allocations
      .map((a) => `${a.studentId}:${a.courseId}`)
      .sort()
      .join("|");

    expect(result.totalAllocated).toBe(120);
    expect(result.totalPreferenceCost).toBe(17);
    expect(createHash("sha256").update(pairs).digest("hex").slice(0, 16)).toBe(
      "4fffc104f65ebdc8"
    );
  });
});
