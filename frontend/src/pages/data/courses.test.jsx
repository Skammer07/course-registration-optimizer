import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { FACULTY, created, fail, ok, renderApp } from "../../test/utils.jsx";

const slot = (day, start, end) => ({ day, start, end });
const course = (courseCode, patch = {}) => ({
  _id: `id-${courseCode}`,
  courseCode,
  title: `${courseCode} title`,
  capacity: 10,
  semesterId: "SEM-A",
  electiveGroup: "PE1",
  isActive: true,
  timetableSlots: [],
  ...patch,
});
const page = (courses) => ok({ courses, total: courses.length, page: 1, limit: 200, totalPages: 1 });
const demandOf = (rows, extra = {}) =>
  ok({ semesterId: "SEM-A", lists: 30, studentsWithLists: 30, courses: rows.map(([courseCode, ranked, firstChoice = 0]) => ({ courseCode, ranked, firstChoice, secondChoice: 0 })), ...extra });
const semesters = ok({ semesters: [{ semesterId: "SEM-A", name: "", recordExists: false, students: 30, courses: 3, preferenceLists: 30, runs: 0, published: false }] });

const COURSES = [
  course("CS101", { capacity: 10, timetableSlots: [slot("Monday", "09:00", "11:00")] }),
  course("CS102", { capacity: 20, electiveGroup: "PE2", timetableSlots: [slot("Monday", "10:00", "12:00")] }),
  course("CS103", { capacity: 5, electiveGroup: "PE2", timetableSlots: [slot("Tuesday", "09:00", "10:00")] }),
];

function open({ courses = COURSES, demand = demandOf([["CS101", 18, 9], ["CS102", 4]]), user, extra = {} } = {}) {
  return renderApp({
    route: "/data/courses?semester=SEM-A",
    user,
    handlers: {
      "GET /api/v1/semesters/overview": semesters,
      "GET /api/v1/courses": page(courses),
      "GET /api/v1/semesters/:id/demand": demand,
      ...extra,
    },
  });
}

beforeEach(() => window.localStorage.clear());

describe("courses and demand", () => {
  it("lists each course with its seats, how many students ranked it, and when it meets", async () => {
    const { callsTo } = open();
    const table = await screen.findByRole("table", { name: /Courses of SEM-A/ });
    const cs101 = within(table).getByText("CS101").closest("tr");
    expect(within(cs101).getByText((_, el) => el.tagName === "P" && el.textContent === "ranked by 18 · 10 seats · 8 over")).toBeInTheDocument();
    expect(within(cs101).getByText("9 as first choice")).toBeInTheDocument();
    expect(within(cs101).getByText("Mon 09:00–11:00")).toBeInTheDocument();
    expect(within(within(table).getByText("CS103").closest("tr")).getByText("Not ranked yet")).toBeInTheDocument();
    expect(callsTo("GET", "/api/v1/courses")[0].query).toMatchObject({ semesterId: "SEM-A", limit: "200" });
  });

  it("shows headline numbers", async () => {
    open();
    const glance = await screen.findByRole("region", { name: "Courses at a glance" });
    await waitFor(() => expect(within(glance).getByText("2 of 3")).toBeInTheDocument()); // courses someone ranked
    expect(within(glance).getByText("35")).toBeInTheDocument(); // seats
    expect(within(glance).getByText("30")).toBeInTheDocument(); // students with a list
  });

  it("marks courses that overlap in time, in words", async () => {
    open();
    const table = await screen.findByRole("table", { name: /Courses of SEM-A/ });
    expect(within(within(table).getByText("CS101").closest("tr")).getByText("Overlaps another course")).toBeInTheDocument();
    expect(within(within(table).getByText("CS103").closest("tr")).queryByText("Overlaps another course")).not.toBeInTheDocument();
  });

  it("warns when only some courses have times, since a run with the clash check would be refused", async () => {
    open({ courses: [...COURSES, course("CS104")] });
    expect(await screen.findByText("Only some courses have a timetable")).toBeInTheDocument();
    expect(screen.getByText(/1 of 4 active courses have no time slots \(CS104\)/)).toBeInTheDocument();
  });

  it("filters by group and by search, and says when nothing matches", async () => {
    const { events } = open();
    await screen.findByRole("table", { name: /Courses of SEM-A/ });
    await events.selectOptions(screen.getByLabelText("Elective group"), "PE2");
    const table = screen.getByRole("table");
    expect(within(table).queryByText("CS101")).not.toBeInTheDocument();
    expect(within(table).getByText("CS102")).toBeInTheDocument();

    await events.type(screen.getByLabelText("Search courses"), "zzz");
    expect(await screen.findByText("No courses match these filters")).toBeInTheDocument();
  });

  it("sorts by most oversubscribed", async () => {
    const { events } = open();
    await screen.findByRole("table", { name: /Courses of SEM-A/ });
    await events.selectOptions(screen.getByLabelText("Sort courses"), "pressure");
    const codes = within(screen.getByRole("table")).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent.slice(0, 5));
    expect(codes[0]).toBe("CS101");
  });

  it("hides inactive courses until asked", async () => {
    const { events } = open({ courses: [...COURSES, course("CS105", { isActive: false })] });
    await screen.findByRole("table", { name: /Courses of SEM-A/ });
    expect(screen.queryByText("CS105")).not.toBeInTheDocument();
    await events.click(screen.getByLabelText("Show inactive"));
    expect(screen.getByText("CS105")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  it("still lists courses when the demand figures are unavailable", async () => {
    open({ demand: fail(500, "INTERNAL_ERROR", "boom") });
    const table = await screen.findByRole("table", { name: /Courses of SEM-A/ });
    expect(within(table).getByText("CS101")).toBeInTheDocument();
    expect(await screen.findByText("Demand is unavailable")).toBeInTheDocument();
  });

  it("shows the error instead of a table when the courses cannot be loaded", async () => {
    open({ extra: { "GET /api/v1/courses": fail(500, "INTERNAL_ERROR", "The server had a problem.") } });
    expect(await screen.findByText("The server had a problem.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("asks for a semester when none is chosen", async () => {
    renderApp({ route: "/data/courses", handlers: { "GET /api/v1/semesters/overview": ok({ semesters: [] }) } });
    expect(await screen.findByText("There is no semester data yet")).toBeInTheDocument();
  });
});

describe("weekly timetable", () => {
  it("draws each class, lists the clashes and the courses without a time", async () => {
    const { events } = open({ courses: [...COURSES, course("CS104")] });
    await events.click(await screen.findByRole("tab", { name: "Weekly timetable" }));
    const grid = screen.getByRole("group", { name: "Weekly timetable" });
    expect(within(grid).getByRole("button", { name: "CS101, Monday 09:00 to 11:00, overlaps with CS102" })).toBeInTheDocument();
    expect(within(grid).getByRole("button", { name: "CS103, Tuesday 09:00 to 10:00" })).toBeInTheDocument();
    expect(screen.getByText("1 clash")).toBeInTheDocument();
    expect(screen.getByText((_, el) => el.tagName === "LI" && el.textContent === "CS101 and CS102 overlap on Monday 10:00–11:00")).toBeInTheDocument();
    expect(screen.getByText(/Not shown \(no time\):/).closest("p")).toHaveTextContent("CS104");
  });

  it("says there are no clashes when there are none", async () => {
    const { events } = open({ courses: [COURSES[0], COURSES[2]] });
    await events.click(await screen.findByRole("tab", { name: "Weekly timetable" }));
    expect(screen.getByText("No clashes")).toBeInTheDocument();
  });

  it("explains when no course has a time", async () => {
    const { events } = open({ courses: [course("CS104")] });
    await events.click(await screen.findByRole("tab", { name: "Weekly timetable" }));
    expect(screen.getByText("No course here has a time slot")).toBeInTheDocument();
  });
});

describe("adding and editing a course", () => {
  it("adds a course to the viewed semester with the code in capitals", async () => {
    const { events, callsTo } = open({
      extra: { "POST /api/v1/courses": (call) => created({ course: { ...call.body, _id: "new-1" } }) },
    });
    await screen.findByRole("table", { name: /Courses of SEM-A/ });
    await events.click(screen.getByRole("button", { name: "Add course" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a course" });

    await events.click(within(dialog).getByRole("button", { name: "Add course" }));
    expect(await within(dialog).findByText("Enter the course code, for example CS101.")).toBeInTheDocument();
    expect(callsTo("POST", "/api/v1/courses")).toHaveLength(0);

    await events.type(within(dialog).getByLabelText(/Course code/), "cs200");
    await events.type(within(dialog).getByLabelText(/Seats/), "45");
    await events.type(within(dialog).getByLabelText(/^Title/), "Compilers");
    await events.type(within(dialog).getByLabelText("Elective group"), "PE1");
    await events.click(within(dialog).getByRole("button", { name: "Add a time slot" }));
    await events.click(within(dialog).getByRole("button", { name: "Add course" }));

    await waitFor(() => expect(callsTo("POST", "/api/v1/courses")).toHaveLength(1));
    expect(callsTo("POST", "/api/v1/courses")[0].body).toEqual({
      courseCode: "CS200",
      title: "Compilers",
      capacity: 45,
      semesterId: "SEM-A",
      kind: "elective",
      departments: [],
      electiveGroup: "PE1",
      timetableSlots: [{ day: "Monday", start: "09:00", end: "10:00" }],
      isActive: true,
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows the API's reason when a course cannot be added", async () => {
    const { events } = open({ extra: { "POST /api/v1/courses": fail(409, "DUPLICATE_KEY", "A course with this code already exists in SEM-A.") } });
    await screen.findByRole("table", { name: /Courses of SEM-A/ });
    await events.click(screen.getByRole("button", { name: "Add course" }));
    const dialog = await screen.findByRole("dialog");
    await events.type(within(dialog).getByLabelText(/Course code/), "CS101");
    await events.type(within(dialog).getByLabelText(/Seats/), "5");
    await events.type(within(dialog).getByLabelText(/^Title/), "Again");
    await events.click(within(dialog).getByRole("button", { name: "Add course" }));
    expect(await within(dialog).findByText("A course with this code already exists in SEM-A.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument(); // stays open so nothing typed is lost
  });

  it("saves only the changed field, and an admin can switch the course off", async () => {
    const { events, callsTo } = open({
      extra: { "PATCH /api/v1/courses/:id": (call) => ok({ course: { ...COURSES[0], ...call.body } }) },
    });
    await events.click(await screen.findByRole("button", { name: "Edit CS101" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit CS101" });
    expect(within(dialog).getByLabelText(/Course code/)).toBeDisabled();

    const seats = within(dialog).getByLabelText(/Seats/);
    await events.clear(seats);
    await events.type(seats, "12");
    await events.click(within(dialog).getByRole("switch", { name: "Active" }));
    await events.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(callsTo("PATCH", "/api/v1/courses/id-CS101")).toHaveLength(1));
    expect(callsTo("PATCH", "/api/v1/courses/id-CS101")[0].body).toEqual({ capacity: 12, isActive: false });
  });

  it("faculty can edit details but are not offered the active switch", async () => {
    const { events } = open({ user: FACULTY });
    await events.click(await screen.findByRole("button", { name: "Edit CS101" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit CS101" });
    expect(within(dialog).queryByRole("switch")).not.toBeInTheDocument();
  });

  it("closes without a request when nothing was changed", async () => {
    const { events, callsTo } = open();
    await events.click(await screen.findByRole("button", { name: "Edit CS101" }));
    const dialog = await screen.findByRole("dialog");
    await events.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(callsTo("PATCH", "/api/v1/courses/id-CS101")).toHaveLength(0);
  });
});
