/**
 * src/utils/timetable.js
 * Single source of truth for timetable slot rules, shared by the Zod request
 * schemas and the Mongoose Course model so data written through scripts or
 * internal services is held to the same rules as API input.
 *
 * Format matches the algorithm (algorithm/src/timetable/checkClash.js):
 *   { day: "Monday", start: "09:00", end: "09:50" }  — 24h "HH:MM".
 */

export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

/** Parse "HH:MM" → minutes since midnight, or null if malformed/out of range. */
export function timeToMinutes(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function isValidTime(value) {
  return timeToMinutes(value) !== null;
}

export function isValidWeekday(day) {
  return WEEKDAYS.includes(day);
}

/** True when the slot has a valid weekday, valid times, and start < end. */
export function isValidSlot(slot) {
  if (!slot || typeof slot !== "object") return false;
  if (!isValidWeekday(slot.day)) return false;
  const start = timeToMinutes(slot.start);
  const end = timeToMinutes(slot.end);
  return start !== null && end !== null && start < end;
}
