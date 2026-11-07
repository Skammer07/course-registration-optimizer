/**
 * src/seed/generateRealistic.js
 * Deterministic mock data that behaves like a real pre-registration: one semester per call, any size.
 * Pure (no database): the same options always give the same data.
 *
 * What makes it "realistic" rather than uniform (all of it mock, chosen to stress the algorithms):
 *   - Compulsory courses: two institute-wide courses plus two per department, each with fixed
 *     weekly slots. They are never allocated, but electives that overlap them are impossible
 *     for those students, so many ranked electives are unavailable to some students.
 *   - 30 open electives in ONE shared pool, offered in both slots (OE1 and OE2). EVERY student
 *     submits a full list of 15 choices per slot. Popularity is skewed (a few courses everyone
 *     wants) and the most popular courses get proportionally fewer seats than demand.
 *   - Seats are tight on purpose (seatFactor < 1 means fewer seats than students x 2), so some
 *     students end with one course or none because of competition and clashes, not because
 *     they did not submit.
 *   - Student mix: uneven departments, a CGPA spread with ties, lists that are sometimes the same
 *     15 courses in both slots (even in the same order), the same set in another order, or two
 *     independent lists.
 *
 * Naming (numbering continues across semesters so ids stay unique in the database):
 *   students  Student0001 / IITISM0001 ...      electives  Course1 / C1 ...
 *   compulsory  Compulsory1 / CC1 ...           logins     iitism0001@seed.local
 *
 * Optional shares (all 0 by default) add imperfect students: unsubmittedShare (never saved a list),
 * draftShare (only a short draft) and oneSlotShare (eligible for one slot only).
 */

import { createSeededRandom } from "../../../algorithm/src/utils/seededRandom.js";

export const OE_GROUPS = ["OE1", "OE2"];
export const CHOICES_PER_LIST = 15;
export const OPEN_ELECTIVE_COUNT = 30;
export const DEPARTMENTS = ["CSE", "ECE", "EE", "ME", "CE"];

const DEPT_WEIGHTS = [0.3, 0.22, 0.18, 0.17, 0.13];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const HOURS = [8, 9, 10, 11, 14, 15, 16];
const PRIME_HOURS = new Set([9, 10, 11]);

const pad = (n, w) => String(n).padStart(w, "0");
const hhmm = (h) => `${pad(h, 2)}:00`;
const slotOf = (day, hour) => ({ day, start: hhmm(hour), end: `${pad(hour, 2)}:50` });

const ALL_SLOTS = DAYS.flatMap((day) => HOURS.map((hour) => ({ day, hour })));

// 2 institute-wide compulsory courses, then 2 per department: 12 in all.
const COMPULSORY_DEPARTMENTS = [DEPARTMENTS, DEPARTMENTS, ...DEPARTMENTS.flatMap((d) => [[d], [d]])];

// The departments whose students tend to want each open elective (index = elective number - 1).
const ELECTIVE_AFFINITY = [
  ["ME", "CE"], ["CSE", "ME"], ["EE", "ME"], ["CSE", "ECE"], ["CSE", "ECE", "ME"],
  ["CSE", "EE"], DEPARTMENTS, ["CE", "ME"], ["CE", "ME"], ["CE", "EE"],
  ["CSE", "ECE"], ["CSE", "EE"], ["CSE", "ECE"], ["ECE", "EE"], ["EE", "ME", "CE"],
  ["ME", "ECE", "EE"], ["CE", "ME", "EE"], ["CSE", "ECE"], ["CE"], ["CSE", "ME", "CE"],
  ["CSE", "ECE", "EE"], ["ME", "CE", "EE"], ["CSE", "ECE"], ["CE", "ME"], ["CSE", "ECE"],
  DEPARTMENTS, DEPARTMENTS, ["CSE", "ECE"], ["CSE", "ME", "EE"], ["ME", "CE", "EE", "ECE"],
];

/** The seat factor used when none is given: larger intakes get tighter seats. */
export function defaultSeatFactor(size) {
  if (size <= 600) return 0.95;
  if (size <= 1200) return 0.85;
  return 0.75;
}

export const realisticEmail = (studentId) => `${studentId.toLowerCase()}@seed.local`;

function pickWeighted(items, weights, random) {
  let total = 0;
  for (const w of weights) total += w;
  let r = random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items.at(-1);
}

/** Weighted sample without replacement (Efraimidis-Spirakis), highest key first. */
function weightedSample(items, weights, count, random) {
  return items
    .map((item, i) => ({ item, key: Math.pow(random(), 1 / weights[i]) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, count)
    .map((x) => x.item);
}

function shuffle(list, random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normal(random) {
  // Box-Muller
  const u = Math.max(random(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/**
 * @param {object} o
 * @param {string} o.semesterId
 * @param {number} o.size             students in this semester
 * @param {number} [o.seed]
 * @param {number} [o.seatFactor]     seats for open electives = size x 2 x seatFactor (it need not equal the
 *                                    number of places students want: above 1 there is a surplus overall)
 * @param {number} [o.seatSkew]       0..1: how closely seats follow popularity. Lower means the most wanted
 *                                    courses are scarcer and the unpopular ones have spare seats.
 * @param {number} [o.herdShare]      share of students who rank only the most popular courses (they are the
 *                                    ones who tend to end with fewer than two courses even when seats are spare)
 * @param {number} [o.studentOffset]  students already numbered in earlier semesters
 * @param {number} [o.courseOffset]   open electives already numbered in earlier semesters
 * @param {number} [o.compulsoryOffset] compulsory courses already numbered in earlier semesters
 */
export function generateRealistic({
  semesterId,
  size,
  seed = 1,
  seatFactor,
  seatSkew = 0.55,
  herdShare = 0.06,
  studentOffset = 0,
  courseOffset = 0,
  compulsoryOffset = 0,
  unsubmittedShare = 0,
  draftShare = 0,
  oneSlotShare = 0,
} = {}) {
  if (!semesterId || typeof semesterId !== "string") throw new Error("semesterId is required.");
  if (!Number.isInteger(size) || size < 30 || size > 20000) throw new Error("size must be an integer between 30 and 20000.");
  const factor = seatFactor ?? defaultSeatFactor(size);
  if (!(factor > 0.2 && factor < 3)) throw new Error("seatFactor must be between 0.2 and 3.");
  if (!(seatSkew >= 0 && seatSkew <= 1)) throw new Error("seatSkew must be between 0 and 1.");
  for (const [name, v] of Object.entries({ unsubmittedShare, draftShare, oneSlotShare, herdShare })) {
    if (!(v >= 0 && v <= 0.5)) throw new Error(`${name} must be between 0 and 0.5.`);
  }

  const random = createSeededRandom(seed * 1000 + size + studentOffset);

  // ---- Compulsory courses: fixed slots, no overlaps within one department's own timetable ----
  const take = (n, used, pool) => {
    const out = [];
    for (const s of pool) {
      const key = `${s.day}${s.hour}`;
      if (used.has(key)) continue;
      used.add(key);
      out.push(s);
      if (out.length === n) break;
    }
    return out;
  };
  const courses = [];
  const instituteUsed = new Set();
  const institutePool = shuffle(ALL_SLOTS, random);
  // every department has its OWN timetable: its own shuffled order, so departments do not all
  // end up busy at the same times
  const departmentUsed = new Map(DEPARTMENTS.map((d) => [d, new Set()]));
  const departmentPool = new Map(DEPARTMENTS.map((d) => [d, shuffle(ALL_SLOTS, random)]));
  COMPULSORY_DEPARTMENTS.forEach((departments, i) => {
    const institute = departments.length === DEPARTMENTS.length;
    let used;
    let pool = institutePool;
    if (institute) used = instituteUsed;
    else {
      pool = departmentPool.get(departments[0]);
      // a department course never overlaps an institute course or another course of its own department
      used = departmentUsed.get(departments[0]);
      for (const key of instituteUsed) used.add(key);
    }
    const number = compulsoryOffset + i + 1;
    courses.push({
      courseCode: `CC${number}`, title: `Compulsory${number}`, kind: "compulsory", departments: [...departments],
      capacity: 0, semesterId, electiveGroup: null,
      timetableSlots: take(2, used, pool).map((s) => slotOf(s.day, s.hour)), isActive: true,
    });
  });
  const compulsoryCount = courses.length;

  // ---- Open electives: one shared pool, skewed popularity, seats that lag behind demand ----
  const order = shuffle(Array.from({ length: OPEN_ELECTIVE_COUNT }, (_, i) => i), random);
  const popularity = new Array(OPEN_ELECTIVE_COUNT);
  order.forEach((courseIndex, rank) => { popularity[courseIndex] = 1 / Math.pow(rank + 1, 0.8); });

  const totalSeats = Math.round(size * OE_GROUPS.length * factor);
  // seats follow popularity only partly, so the most wanted courses are the scarcest per student
  const seatShare = popularity.map((p) => Math.pow(p, seatSkew) * (0.75 + random() * 0.5));
  const shareSum = seatShare.reduce((a, b) => a + b, 0);
  const capacities = seatShare.map((s) => Math.max(10, Math.round((s / shareSum) * totalSeats)));

  // an elective is never scheduled while every student has an institute-wide class
  const electiveSlots = ALL_SLOTS.filter((s) => !instituteUsed.has(`${s.day}${s.hour}`));
  const slotWeights = electiveSlots.map((s) => (PRIME_HOURS.has(s.hour) ? 2 : 1));
  const oeCodes = [];
  for (let i = 0; i < OPEN_ELECTIVE_COUNT; i++) {
    const slots = [];
    const wanted = random() < 0.7 ? 2 : 1;
    const days = new Set();
    while (slots.length < wanted) {
      const s = pickWeighted(electiveSlots, slotWeights, random);
      if (days.has(s.day)) continue; // two weekly meetings on different days
      days.add(s.day);
      slots.push(slotOf(s.day, s.hour));
    }
    const number = courseOffset + i + 1;
    oeCodes.push(`C${number}`);
    courses.push({
      courseCode: `C${number}`, title: `Course${number}`, kind: "elective", departments: [], capacity: capacities[i],
      semesterId, electiveGroup: null, timetableSlots: slots, isActive: true,
    });
  }

  // ---- Students ----
  const students = [];
  const preferences = [];
  const width = Math.max(4, String(studentOffset + size).length);

  for (let n = 1; n <= size; n++) {
    const number = studentOffset + n;
    const department = pickWeighted(DEPARTMENTS, DEPT_WEIGHTS, random);
    let cgpa = 7.7 + normal(random) * 1.05;
    cgpa = Math.min(9.95, Math.max(5, cgpa));
    cgpa = random() < 0.2 ? Math.round(cgpa * 10) / 10 : Math.round(cgpa * 100) / 100; // some equal CGPAs
    const studentId = `IITISM${pad(number, width)}`;
    const electiveGroups = random() < oneSlotShare ? [random() < 0.5 ? "OE1" : "OE2"] : [...OE_GROUPS];

    students.push({ studentId, name: `Student${pad(number, width)}`, cgpa, department, semesterId, electiveGroups, isActive: true });

    const behaviour = random();
    if (behaviour < unsubmittedShare) continue; // never saved a list
    const draftOnly = behaviour < unsubmittedShare + draftShare;

    // department affinity: electives that suit the student's department are ranked higher
    const herd = random() < herdShare;
    const weights = popularity.map((p, i) =>
      herd ? Math.pow(p, 4) : p * (ELECTIVE_AFFINITY[i].includes(department) ? 2.5 : 1)
    );
    const first = weightedSample(oeCodes, weights, CHOICES_PER_LIST, random);
    const style = random();
    let second;
    if (style < 0.25) second = [...first]; // the very same list
    else if (style < 0.65) second = shuffle(first, random); // same courses, other order
    else second = weightedSample(oeCodes, weights, CHOICES_PER_LIST, random); // independent
    const lists = { OE1: first, OE2: second };

    for (const group of electiveGroups) {
      const list = draftOnly ? lists[group].slice(0, 3 + Math.floor(random() * 6)) : lists[group];
      preferences.push({ studentId, semesterId, electiveGroup: group, courseCodes: list, status: draftOnly ? "draft" : "submitted" });
    }
  }

  return {
    meta: {
      semesterId, size, seed, seatFactor: factor, seatSkew, totalSeats, openElectives: OPEN_ELECTIVE_COUNT, compulsoryCourses: compulsoryCount,
      firstStudent: students[0].studentId, lastStudent: students.at(-1).studentId, firstCourse: oeCodes[0], lastCourse: oeCodes.at(-1),
    },
    students,
    courses,
    preferences,
  };
}
