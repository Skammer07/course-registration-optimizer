/**
 * Timetable helpers. The clash rule is the same one the algorithm uses: two slots clash when
 * they are on the same day and overlap in time; back-to-back classes do not clash.
 */

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const SHORT_DAY = Object.fromEntries(WEEKDAYS.map((d) => [d, d.slice(0, 3)]));

/** "09:30" -> 570, or null when malformed. */
export function toMinutes(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm ?? ""));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h > 23 || min > 59 ? null : h * 60 + min;
}

export function minutesToClock(total) {
  const t = Math.max(0, Math.round(total));
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

/** "Mon 09:00–10:00" */
export function formatSlot(slot) {
  return `${SHORT_DAY[slot.day] ?? slot.day} ${slot.start}–${slot.end}`;
}

/** Valid weekday, valid times, start before end. */
export function isValidSlot(slot) {
  const start = toMinutes(slot?.start);
  const end = toMinutes(slot?.end);
  return WEEKDAYS.includes(slot?.day) && start !== null && end !== null && start < end;
}

const overlap = (a, b) => {
  const start = Math.max(toMinutes(a.start), toMinutes(b.start));
  const end = Math.min(toMinutes(a.end), toMinutes(b.end));
  return end > start ? { start, end } : null;
};

/**
 * Pairs of courses with slots that overlap. Each pair appears once, with the first overlapping
 * stretch (day, start, end) for it.
 * @param {{ courseCode: string, timetableSlots?: object[] }[]} courses
 * @returns {{ a: string, b: string, day: string, start: string, end: string }[]}
 */
export function findClashes(courses) {
  const clashes = [];
  for (let i = 0; i < courses.length; i++) {
    for (let j = i + 1; j < courses.length; j++) {
      const found = firstOverlap(courses[i].timetableSlots ?? [], courses[j].timetableSlots ?? []);
      if (found) clashes.push({ a: courses[i].courseCode, b: courses[j].courseCode, ...found });
    }
  }
  return clashes;
}

function firstOverlap(slotsA, slotsB) {
  for (const x of slotsA) {
    for (const y of slotsB) {
      if (x.day !== y.day || !isValidSlot(x) || !isValidSlot(y)) continue;
      const o = overlap(x, y);
      if (o) return { day: x.day, start: minutesToClock(o.start), end: minutesToClock(o.end) };
    }
  }
  return null;
}

/**
 * The first fixed (compulsory) course that `course` overlaps, as
 * { code, day, start, end }, or null. Used to warn a student before they rank it.
 */
export function overlapsFixed(course, fixedCourses) {
  for (const fixed of fixedCourses ?? []) {
    const found = firstOverlap(course.timetableSlots ?? [], fixed.timetableSlots ?? []);
    if (found) return { code: fixed.courseCode, ...found };
  }
  return null;
}

/** Codes of courses that have at least one clash, for highlighting. */
export function clashingCodes(clashes) {
  return new Set(clashes.flatMap((c) => [c.a, c.b]));
}

/**
 * Place the blocks of ONE day side by side where they overlap, so none hides another.
 * Returns each block with `lane` (0-based column) and `lanes` (columns in its cluster).
 * @param {{ start: number, end: number }[]} blocks  minutes since midnight
 */
export function layoutLanes(blocks) {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end);
  const placed = [];
  let cluster = [];
  let clusterEnd = -1;

  const flush = () => {
    const lanes = cluster.reduce((max, b) => Math.max(max, b.lane + 1), 1);
    for (const b of cluster) b.lanes = lanes;
    placed.push(...cluster);
    cluster = [];
  };

  for (const block of sorted) {
    if (cluster.length && block.start >= clusterEnd) flush();
    // first lane that is free by the time this block starts
    const laneEnds = [];
    for (const b of cluster) laneEnds[b.lane] = Math.max(laneEnds[b.lane] ?? 0, b.end);
    let lane = 0;
    while (laneEnds[lane] !== undefined && laneEnds[lane] > block.start) lane++;
    cluster.push({ ...block, lane });
    clusterEnd = Math.max(clusterEnd, block.end);
  }
  if (cluster.length) flush();
  return placed;
}

/**
 * Everything the weekly grid needs: the days to show (Mon-Fri always, weekend only if used),
 * the hour range, and each day's blocks laid out in lanes.
 * @returns {{ days: string[], startHour: number, endHour: number, blocksByDay: Record<string, object[]>, hasSlots: boolean }}
 */
export function buildWeekGrid(courses) {
  const raw = [];
  for (const c of courses) {
    for (const s of c.timetableSlots ?? []) {
      if (!isValidSlot(s)) continue;
      raw.push({ courseCode: c.courseCode, title: c.title, group: c.electiveGroup, day: s.day, start: toMinutes(s.start), end: toMinutes(s.end), slot: s });
    }
  }
  const usedDays = new Set(raw.map((b) => b.day));
  const days = WEEKDAYS.filter((d, i) => i < 5 || usedDays.has(d));

  const startHour = raw.length ? Math.floor(Math.min(...raw.map((b) => b.start)) / 60) : 8;
  const endHour = raw.length ? Math.ceil(Math.max(...raw.map((b) => b.end)) / 60) : 17;

  const blocksByDay = Object.fromEntries(days.map((d) => [d, layoutLanes(raw.filter((b) => b.day === d))]));
  return { days, startHour, endHour: Math.max(endHour, startHour + 1), blocksByDay, hasSlots: raw.length > 0 };
}

/** Active courses with no slots at all. */
export function coursesWithoutSlots(courses) {
  return courses.filter((c) => !(c.timetableSlots?.length > 0));
}
