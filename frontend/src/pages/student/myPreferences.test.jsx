import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { STUDENT, fail, ok, renderApp } from "../../test/utils.jsx";
import {
  MAX_CHOICES, addCourse, groupsFor, moveCourse, poolFor, removeCourse, requiredChoices, sameList,
} from "../../features/preferences/ranking.js";

const slot = (day, start, end) => ({ day, start, end });
const course = (code, patch = {}) => ({ _id: `id-${code}`, courseCode: code, title: `${code} title`, capacity: 10, semesterId: "SEM-A", electiveGroup: "PE1", isActive: true, timetableSlots: [], ...patch });
const COURSES = [course("A1", { timetableSlots: [slot("Monday", "09:00", "11:00")] }), course("A2", { timetableSlots: [slot("Monday", "10:00", "12:00")] }), course("A3"), course("O1", { electiveGroup: "OE1" })];
const me = { _id: STUDENT.student, studentId: "S1", name: "Me", cgpa: 8, semesterId: "SEM-A", electiveGroups: ["PE1"], isActive: true };
const status = (patch = {}) => ok({ semesterId: "SEM-A", status: "preferences-open", preferencesOpen: true, closesAt: null, opensAt: null, ...patch });

const MATHS = { courseCode: "MA201", title: "Engineering Mathematics III", timetableSlots: [slot("Monday", "10:00", "10:50")] };
const compulsoryOf = (courses = []) => ok({ semesterId: "SEM-A", department: "CSE", courses });

function open({ saved = [], statusRes = status(), student = me, compulsory = [], extra = {} } = {}) {
  return renderApp({
    route: "/my-preferences",
    user: STUDENT,
    handlers: {
      "GET /api/v1/students/:id": ok({ student }),
      "GET /api/v1/semesters/:id/status": statusRes,
      "GET /api/v1/courses": ok({ courses: COURSES, total: 4, page: 1, limit: 200, totalPages: 1 }),
      "GET /api/v1/preferences/me": ok({ preferences: saved }),
      "GET /api/v1/courses/my-compulsory": compulsoryOf(compulsory),
      ...extra,
    },
  });
}

describe("ranking helpers", () => {
  it("adds without repeats, removes, moves within bounds", () => {
    expect(addCourse(["a"], "b")).toEqual(["a", "b"]);
    expect(addCourse(["a"], "a")).toEqual(["a"]);
    expect(removeCourse(["a", "b"], "a")).toEqual(["b"]);
    expect(moveCourse(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    const l = ["a", "b"];
    expect(moveCourse(l, 0, -1)).toBe(l);
    expect(moveCourse(l, 1, 1)).toBe(l);
    expect(sameList(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameList(["a", "b"], ["b", "a"])).toBe(false);
  });
  it("uses the student's groups, else every group that has courses", () => {
    expect(groupsFor({ electiveGroups: ["X"] }, COURSES)).toEqual(["X"]);
    expect(groupsFor({ electiveGroups: [] }, COURSES)).toEqual(["OE1", "PE1"]);
  });
});

describe("my preferences", () => {
  it("shows only the student's groups and lets them rank, reorder and submit", async () => {
    const { events, callsTo } = open({ extra: { "PUT /api/v1/preferences/me": (c) => ok({ preference: { ...c.body } }) } });
    const card = (await screen.findByRole("heading", { name: "Group PE1" })).closest("section");
    expect(screen.queryByRole("heading", { name: "Group OE1" })).not.toBeInTheDocument();

    await events.click(within(card).getByRole("button", { name: "Add A3" }));
    await events.click(within(card).getByRole("button", { name: "Add A1" }));
    await events.click(within(card).getByRole("button", { name: "Move A1 up" }));
    await events.click(within(card).getByRole("button", { name: "Add A2" }));
    await events.click(within(card).getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(callsTo("PUT", "/api/v1/preferences/me")).toHaveLength(1));
    expect(callsTo("PUT", "/api/v1/preferences/me")[0].body).toEqual({ semesterId: "SEM-A", electiveGroup: "PE1", rankedCourseIds: ["id-A1", "id-A3", "id-A2"], status: "submitted" });
  });

  it("warns when ranked courses meet at the same time", async () => {
    const { events } = open();
    const card = (await screen.findByRole("heading", { name: "Group PE1" })).closest("section");
    await events.click(within(card).getByRole("button", { name: "Add A1" }));
    await events.click(within(card).getByRole("button", { name: "Add A2" }));
    expect(within(card).getByText("Some of your choices meet at the same time")).toBeInTheDocument();
  });

  it("starts from the saved list", async () => {
    open({ saved: [{ _id: "p", electiveGroup: "PE1", status: "draft", rankedCourseIds: [{ _id: "id-A3" }, { _id: "id-A1" }] }] });
    const card = (await screen.findByRole("heading", { name: "Group PE1" })).closest("section");
    expect(within(card).getByText("Draft saved, not submitted")).toBeInTheDocument();
    expect(within(card).getByLabelText("Choice 1").closest("li")).toHaveTextContent("A3 title");
  });

  it("is read-only when the window is closed", async () => {
    open({ statusRes: status({ status: "allocation-pending", preferencesOpen: false }) });
    expect(await screen.findByText("You cannot change your preferences now")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add A1" })).not.toBeInTheDocument();
  });

  it("shows the API's reason when saving fails", async () => {
    const { events } = open({ extra: { "PUT /api/v1/preferences/me": fail(403, "PREFERENCES_CLOSED", "Preferences are closed.") } });
    const card = (await screen.findByRole("heading", { name: "Group PE1" })).closest("section");
    await events.click(within(card).getByRole("button", { name: "Add A3" }));
    await events.click(within(card).getByRole("button", { name: "Save draft" }));
    expect(await within(card).findByText("Preferences are closed.")).toBeInTheDocument();
  });
});

describe("my preferences: compulsory classes", () => {
  it("shows the student's compulsory classes above the groups", async () => {
    open({ compulsory: [MATHS] });
    const heading = await screen.findByRole("heading", { name: "Your compulsory classes" });
    const item = within(heading.closest("section")).getAllByRole("listitem")[0];
    expect(item).toHaveTextContent("Engineering Mathematics III");
    expect(item).toHaveTextContent("Mon 10:00–10:50");
  });

  it("shows nothing extra when the student has no compulsory classes", async () => {
    open();
    await screen.findByRole("heading", { name: "Group PE1" });
    expect(screen.queryByRole("heading", { name: "Your compulsory classes" })).not.toBeInTheDocument();
  });

  it("flags an elective that overlaps a compulsory class, in the list and when it is ranked", async () => {
    const { events } = open({ compulsory: [MATHS] });
    const card = (await screen.findByRole("heading", { name: "Group PE1" })).closest("section");

    // A1 (Mon 09:00-11:00) and A2 (Mon 10:00-12:00) overlap MA201 (Mon 10:00-10:50); A3 has no time
    expect(within(card).getAllByText("Overlaps MA201")).toHaveLength(2);

    await events.click(within(card).getByRole("button", { name: "Add A1" }));
    expect(within(card).getByText("Some of your choices overlap a compulsory class")).toBeInTheDocument();
    expect(within(card).getByText(/A1 overlaps MA201 on Monday 10:00–10:50/)).toBeInTheDocument();
    expect(within(card).getByText(/they will not be allocated to you/)).toBeInTheDocument();
  });

  it("does not warn about an elective that does not overlap", async () => {
    const { events } = open({ compulsory: [MATHS] });
    const card = (await screen.findByRole("heading", { name: "Group PE1" })).closest("section");
    await events.click(within(card).getByRole("button", { name: "Add A3" }));
    expect(within(card).queryByText("Some of your choices overlap a compulsory class")).not.toBeInTheDocument();
  });

  it("works as before when the compulsory list cannot be loaded", async () => {
    open({ extra: { "GET /api/v1/courses/my-compulsory": fail(500, "INTERNAL_ERROR", "Unavailable") } });
    expect(await screen.findByRole("heading", { name: "Group PE1" })).toBeInTheDocument();
    expect(screen.queryByText(/Overlaps/)).not.toBeInTheDocument();
  });
});

describe("my preferences: 15 choices and the shared pool", () => {
  const pool = (n) => Array.from({ length: n }, (_, i) => course(`P${i + 1}`, { electiveGroup: null }));
  const meOE = { ...me, electiveGroups: ["OE1", "OE2"] };
  const openPool = (n, extra = {}) =>
    open({ student: meOE, extra: { "GET /api/v1/courses": ok({ courses: [...pool(n), course("MA1", { electiveGroup: null, kind: "compulsory", departments: ["CSE"] })], total: n + 1, page: 1, limit: 200, totalPages: 1 }), ...extra } });

  it("poolFor offers open electives and the group's own, never compulsory ones", () => {
    const all = [course("G1", { electiveGroup: "OE1" }), course("G2", { electiveGroup: "OE2" }), course("O", { electiveGroup: null }), course("C", { electiveGroup: null, kind: "compulsory" })];
    expect(poolFor(all, "OE1").map((c) => c.courseCode)).toEqual(["G1", "O"]);
    expect(poolFor(all, "OE2").map((c) => c.courseCode)).toEqual(["G2", "O"]);
  });

  it("requiredChoices is 15, or every course when fewer exist", () => {
    expect(MAX_CHOICES).toBe(15);
    expect(requiredChoices(25)).toBe(15);
    expect(requiredChoices(6)).toBe(6);
  });

  it("both groups list the same pool of courses, and compulsory courses are not offered", async () => {
    openPool(25);
    const oe1 = (await screen.findByRole("heading", { name: "Group OE1" })).closest("section");
    const oe2 = screen.getByRole("heading", { name: "Group OE2" }).closest("section");
    for (const card of [oe1, oe2]) {
      expect(within(card).getByRole("button", { name: "Add P1" })).toBeInTheDocument();
      expect(within(card).getByRole("button", { name: "Add P25" })).toBeInTheDocument();
      expect(within(card).queryByRole("button", { name: "Add MA1" })).not.toBeInTheDocument();
      expect(within(card).getByText("0 of 15 chosen")).toBeInTheDocument();
    }
    expect(screen.getByText("OE1 and OE2 are separate priority lists")).toBeInTheDocument();
  });

  it("stops at 15 choices and only then allows Submit", async () => {
    const { events, callsTo } = openPool(25, { "PUT /api/v1/preferences/me": (c) => ok({ preference: { ...c.body } }) });
    const card = (await screen.findByRole("heading", { name: "Group OE1" })).closest("section");

    for (let i = 1; i <= 14; i++) await events.click(within(card).getByRole("button", { name: `Add P${i}` }));
    expect(within(card).getByText("14 of 15 chosen")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Submit" })).toBeDisabled();
    expect(within(card).getByText(/Choose 1 more to submit \(15 needed\)/)).toBeInTheDocument();

    await events.click(within(card).getByRole("button", { name: "Add P15" }));
    expect(within(card).getByText("15 of 15 chosen")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Add P16" })).toBeDisabled(); // the list is full
    expect(within(card).getByRole("button", { name: "Submit" })).toBeEnabled();

    await events.click(within(card).getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(callsTo("PUT", "/api/v1/preferences/me")).toHaveLength(1));
    const body = callsTo("PUT", "/api/v1/preferences/me")[0].body;
    expect(body).toMatchObject({ electiveGroup: "OE1", status: "submitted" });
    expect(body.rankedCourseIds).toHaveLength(15);
  });

  it("the second list is independent and may repeat courses from the first", async () => {
    const { events } = openPool(25);
    const oe1 = (await screen.findByRole("heading", { name: "Group OE1" })).closest("section");
    const oe2 = screen.getByRole("heading", { name: "Group OE2" }).closest("section");
    await events.click(within(oe1).getByRole("button", { name: "Add P1" }));
    expect(within(oe1).getByText("1 of 15 chosen")).toBeInTheDocument();
    expect(within(oe2).getByText("0 of 15 chosen")).toBeInTheDocument();
    await events.click(within(oe2).getByRole("button", { name: "Add P1" })); // the same course again
    expect(within(oe2).getByText("1 of 15 chosen")).toBeInTheDocument();
  });

  it("with fewer than 15 courses a submitted list must hold all of them", async () => {
    const { events } = openPool(4);
    const card = (await screen.findByRole("heading", { name: "Group OE1" })).closest("section");
    for (let i = 1; i <= 3; i++) await events.click(within(card).getByRole("button", { name: `Add P${i}` }));
    expect(within(card).getByRole("button", { name: "Submit" })).toBeDisabled();
    await events.click(within(card).getByRole("button", { name: "Add P4" }));
    expect(within(card).getByText("4 of 4 chosen")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Submit" })).toBeEnabled();
  });

  it("a draft can be saved with any number of choices", async () => {
    const { events } = openPool(25);
    const card = (await screen.findByRole("heading", { name: "Group OE1" })).closest("section");
    await events.click(within(card).getByRole("button", { name: "Add P3" }));
    expect(within(card).getByRole("button", { name: "Save draft" })).toBeEnabled();
  });
});
