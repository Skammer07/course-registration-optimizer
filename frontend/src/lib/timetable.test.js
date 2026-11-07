import { describe, expect, it } from "vitest";
import { buildWeekGrid, clashingCodes, coursesWithoutSlots, findClashes, formatSlot, isValidSlot, layoutLanes, toMinutes } from "./timetable.js";

const course = (courseCode, ...slots) => ({ courseCode, title: courseCode, timetableSlots: slots.map(([day, start, end]) => ({ day, start, end })) });

describe("times", () => {
  it("reads HH:MM and rejects anything else", () => {
    expect(toMinutes("09:30")).toBe(570);
    expect(toMinutes("24:00")).toBeNull();
    expect(toMinutes("9:30")).toBeNull();
    expect(toMinutes(undefined)).toBeNull();
  });

  it("a slot needs a weekday, real times and a start before the end", () => {
    expect(isValidSlot({ day: "Monday", start: "09:00", end: "10:00" })).toBe(true);
    expect(isValidSlot({ day: "Monday", start: "10:00", end: "10:00" })).toBe(false);
    expect(isValidSlot({ day: "Funday", start: "09:00", end: "10:00" })).toBe(false);
  });

  it("formats a slot compactly", () => {
    expect(formatSlot({ day: "Wednesday", start: "09:00", end: "10:30" })).toBe("Wed 09:00–10:30");
  });
});

describe("clashes", () => {
  it("finds courses that overlap on the same day, and reports the overlapping stretch", () => {
    const clashes = findClashes([course("A", ["Monday", "09:00", "11:00"]), course("B", ["Monday", "10:00", "12:00"])]);
    expect(clashes).toEqual([{ a: "A", b: "B", day: "Monday", start: "10:00", end: "11:00" }]);
  });

  it("back-to-back classes and different days do not clash", () => {
    const list = [course("A", ["Monday", "09:00", "10:00"]), course("B", ["Monday", "10:00", "11:00"]), course("C", ["Tuesday", "09:00", "10:00"])];
    expect(findClashes(list)).toEqual([]);
  });

  it("reports each pair once even when several slots overlap", () => {
    const a = course("A", ["Monday", "09:00", "10:00"], ["Friday", "09:00", "10:00"]);
    const b = course("B", ["Monday", "09:30", "10:30"], ["Friday", "09:30", "10:30"]);
    expect(findClashes([a, b])).toHaveLength(1);
  });

  it("lists the codes involved, and ignores courses without slots", () => {
    const list = [course("A", ["Monday", "09:00", "10:00"]), course("B", ["Monday", "09:30", "10:30"]), course("C")];
    expect([...clashingCodes(findClashes(list))].sort()).toEqual(["A", "B"]);
    expect(coursesWithoutSlots(list).map((c) => c.courseCode)).toEqual(["C"]);
  });
});

describe("laying out a day", () => {
  it("puts overlapping blocks side by side and leaves the rest full width", () => {
    const placed = layoutLanes([
      { id: "a", start: 540, end: 660 },
      { id: "b", start: 600, end: 720 },
      { id: "c", start: 780, end: 840 },
    ]);
    const by = Object.fromEntries(placed.map((p) => [p.id, p]));
    expect([by.a.lane, by.a.lanes]).toEqual([0, 2]);
    expect([by.b.lane, by.b.lanes]).toEqual([1, 2]);
    expect([by.c.lane, by.c.lanes]).toEqual([0, 1]);
  });

  it("reuses a free lane once an earlier block has ended", () => {
    const placed = layoutLanes([
      { id: "a", start: 540, end: 600 },
      { id: "b", start: 570, end: 690 },
      { id: "c", start: 610, end: 700 },
    ]);
    const by = Object.fromEntries(placed.map((p) => [p.id, p]));
    expect(by.c.lane).toBe(0); // a has finished by 10:10
    expect(by.c.lanes).toBe(2);
  });
});

describe("the week grid", () => {
  it("shows Monday to Friday, adds a weekend day only when used, and fits the hours to the classes", () => {
    const weekday = buildWeekGrid([course("A", ["Monday", "09:15", "10:45"]), course("B", ["Thursday", "14:00", "15:00"])]);
    expect(weekday.days).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
    expect([weekday.startHour, weekday.endHour]).toEqual([9, 15]);
    expect(weekday.hasSlots).toBe(true);

    const withSaturday = buildWeekGrid([course("A", ["Saturday", "09:00", "10:00"])]);
    expect(withSaturday.days).toContain("Saturday");
    expect(withSaturday.days).not.toContain("Sunday");
  });

  it("has sensible defaults and says so when there is nothing to draw", () => {
    const empty = buildWeekGrid([course("A")]);
    expect(empty.hasSlots).toBe(false);
    expect(empty.endHour).toBeGreaterThan(empty.startHour);
  });
});
