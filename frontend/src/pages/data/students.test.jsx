import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { FACULTY, created, fail, ok, renderApp } from "../../test/utils.jsx";

const semesters = ok({ semesters: [{ semesterId: "SEM-A", name: "", recordExists: false, students: 3, courses: 3, preferenceLists: 4, runs: 0, published: false }] });

const student = (n, patch = {}) => ({
  _id: `sid-${n}`,
  studentId: `S00${n}`,
  name: `Student ${n}`,
  cgpa: 8 + n / 10,
  department: "CSE",
  electiveGroups: [],
  isActive: true,
  status: "complete",
  groups: { PE1: { status: "submitted", count: 3 }, OE1: { status: "submitted", count: 2 } },
  ...patch,
});

const STUDENTS = [
  student(1),
  student(2, { status: "incomplete", groups: { PE1: { status: "submitted", count: 3 }, OE1: { status: "draft", count: 1 } } }),
  student(3, { status: "none", department: "ECE", groups: { PE1: { status: "missing", count: 0 }, OE1: { status: "na", count: 0 } } }),
];

const overviewOf = (students = STUDENTS, patch = {}) =>
  ok({
    semesterId: "SEM-A",
    groups: ["PE1", "OE1"],
    departments: ["CSE", "ECE"],
    summary: {
      students: 3, complete: 1, incomplete: 1, none: 1,
      perGroup: { PE1: { submitted: 2, draft: 0, missing: 1 }, OE1: { submitted: 1, draft: 1, missing: 0 } },
    },
    students,
    total: students.length,
    page: 1,
    limit: 25,
    totalPages: 1,
    ...patch,
  });

function open({ route = "/data/students?semester=SEM-A", user, overview = overviewOf(), extra = {} } = {}) {
  return renderApp({
    route,
    user,
    handlers: { "GET /api/v1/semesters/overview": semesters, "GET /api/v1/preferences/overview": overview, ...extra },
  });
}

beforeEach(() => window.localStorage.clear());

describe("students and their preference progress", () => {
  it("shows the totals and each student's progress, with a badge per elective group", async () => {
    const { callsTo } = open();
    const glance = await screen.findByRole("region", { name: "Preference progress" });
    expect(within(glance).getByText("Submitted everything")).toBeInTheDocument();

    const table = await screen.findByRole("table");
    const asha = within(table).getByText("Student 2").closest("tr");
    expect(within(asha).getByText("Partly done")).toBeInTheDocument();
    expect(within(asha).getByText("PE1 · 3 ranked")).toBeInTheDocument();
    expect(within(asha).getByText("OE1 · Draft")).toBeInTheDocument();

    const none = within(table).getByText("Student 3").closest("tr");
    expect(within(none).getByText("Not started")).toBeInTheDocument();
    expect(within(none).getByText("PE1 · Missing")).toBeInTheDocument();
    expect(within(none).getByText("OE1: –")).toBeInTheDocument(); // not one of this student's groups

    expect(screen.getByText("PE1: 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("OE1: 1 of 2")).toBeInTheDocument();
    expect(callsTo("GET", "/api/v1/preferences/overview")[0].query).toMatchObject({ semesterId: "SEM-A", page: "1", limit: "25" });
  });

  it("sends the filters to the API", async () => {
    const { events, callsTo } = open();
    await screen.findByRole("table");
    await events.selectOptions(screen.getByLabelText("Progress"), "none");
    await waitFor(() => expect(callsTo("GET", "/api/v1/preferences/overview").at(-1).query.status).toBe("none"));
    await events.selectOptions(screen.getByLabelText("Department"), "ECE");
    await waitFor(() => expect(callsTo("GET", "/api/v1/preferences/overview").at(-1).query.department).toBe("ECE"));
    await events.click(screen.getByLabelText("Show inactive"));
    await waitFor(() => expect(callsTo("GET", "/api/v1/preferences/overview").at(-1).query.includeInactive).toBe("true"));
    await events.type(screen.getByLabelText("Search students"), "asha");
    await waitFor(() => expect(callsTo("GET", "/api/v1/preferences/overview").at(-1).query.search).toBe("asha"));
  });

  it("explains an empty result, and an empty semester", async () => {
    open({ overview: overviewOf([], { total: 0, totalPages: 0 }) });
    expect(await screen.findByText("This semester has no students yet")).toBeInTheDocument();
  });

  it("moves between pages", async () => {
    const { events, callsTo } = open({ overview: overviewOf(STUDENTS, { total: 60, totalPages: 3 }) });
    await screen.findByRole("table");
    expect(screen.getByText(/Showing/)).toHaveTextContent("1–25 of 60 students");
    await events.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(callsTo("GET", "/api/v1/preferences/overview").at(-1).query.page).toBe("2"));
  });

  it("shows the error instead of a table when the list cannot be loaded", async () => {
    open({ overview: fail(500, "INTERNAL_ERROR", "The server had a problem.") });
    expect(await screen.findByText("The server had a problem.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("marks an inactive student", async () => {
    open({ overview: overviewOf([student(1, { isActive: false })]) });
    expect(await screen.findByText("Inactive")).toBeInTheDocument();
  });
});

describe("adding and editing a student", () => {
  it("adds a student to the viewed semester with the ID in capitals", async () => {
    const { events, callsTo } = open({ extra: { "POST /api/v1/students": (call) => created({ student: { ...call.body, _id: "new" } }) } });
    await screen.findByRole("table");
    await events.click(screen.getByRole("button", { name: "Add student" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a student" });

    await events.click(within(dialog).getByRole("button", { name: "Add student" }));
    expect(await within(dialog).findByText("Enter the student ID, for example 21CS001.")).toBeInTheDocument();
    expect(callsTo("POST", "/api/v1/students")).toHaveLength(0);

    await events.type(within(dialog).getByLabelText(/Student ID/), "21cs009");
    await events.type(within(dialog).getByLabelText(/^Name/), "New Student");
    await events.type(within(dialog).getByLabelText(/CGPA/), "7.5");
    await events.type(within(dialog).getByLabelText("Elective groups"), "PE1, OE1");
    await events.click(within(dialog).getByRole("button", { name: "Add student" }));

    await waitFor(() => expect(callsTo("POST", "/api/v1/students")).toHaveLength(1));
    expect(callsTo("POST", "/api/v1/students")[0].body).toEqual({
      studentId: "21CS009",
      name: "New Student",
      cgpa: 7.5,
      department: "",
      semesterId: "SEM-A",
      electiveGroups: ["PE1", "OE1"],
      isActive: true,
    });
  });

  it("an admin can change marks and groups", async () => {
    const { events, callsTo } = open({ extra: { "PATCH /api/v1/students/:id": (call) => ok({ student: { ...STUDENTS[0], ...call.body } }) } });
    await events.click(await screen.findByRole("button", { name: "Edit S001" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit S001" });
    const cgpa = within(dialog).getByLabelText(/CGPA/);
    expect(cgpa).toBeEnabled();
    await events.clear(cgpa);
    await events.type(cgpa, "9.1");
    await events.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(callsTo("PATCH", "/api/v1/students/sid-1")).toHaveLength(1));
    expect(callsTo("PATCH", "/api/v1/students/sid-1")[0].body).toEqual({ cgpa: 9.1 });
  });

  it("faculty can change the name and department only", async () => {
    const { events, callsTo } = open({
      user: FACULTY,
      extra: { "PATCH /api/v1/students/:id": (call) => ok({ student: { ...STUDENTS[0], ...call.body } }) },
    });
    await events.click(await screen.findByRole("button", { name: "Edit S001" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit S001" });
    expect(within(dialog).getByLabelText(/CGPA/)).toBeDisabled();
    expect(within(dialog).getByLabelText("Elective groups")).toBeDisabled();
    expect(within(dialog).queryByRole("switch")).not.toBeInTheDocument();

    const name = within(dialog).getByLabelText(/^Name/);
    await events.clear(name);
    await events.type(name, "Renamed");
    await events.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(callsTo("PATCH", "/api/v1/students/sid-1")).toHaveLength(1));
    expect(callsTo("PATCH", "/api/v1/students/sid-1")[0].body).toEqual({ name: "Renamed" });
  });
});

describe("one student", () => {
  const detail = { _id: "sid-1", studentId: "S001", name: "Student 1", cgpa: 8.1, department: "CSE", semesterId: "SEM-A", electiveGroups: ["PE1"], isActive: true };
  const slot = (day, start, end) => ({ day, start, end });
  const ref = (courseCode, title) => ({ _id: `c-${courseCode}`, courseCode, title, semesterId: "SEM-A", electiveGroup: "PE1" });
  const lists = [
    { _id: "p1", electiveGroup: "PE1", status: "submitted", semesterId: "SEM-A", rankedCourseIds: [ref("CS101", "Machine Learning"), ref("CS102", "Databases"), ref("CS103", "Networks")] },
    { _id: "p2", electiveGroup: "OE1", status: "draft", semesterId: "SEM-A", rankedCourseIds: [ref("CS103", "Networks")] },
  ];
  const courses = [
    { ...ref("CS101", "Machine Learning"), capacity: 10, timetableSlots: [slot("Monday", "09:00", "11:00")] },
    { ...ref("CS102", "Databases"), capacity: 1, timetableSlots: [slot("Monday", "10:00", "12:00")] },
    { ...ref("CS103", "Networks"), capacity: 20, timetableSlots: [] },
  ];
  const handlers = (extra = {}) => ({
    "GET /api/v1/semesters/overview": semesters,
    "GET /api/v1/students/:id": ok({ student: detail }),
    "GET /api/v1/preferences": ok({ preferences: lists, total: 2, page: 1, limit: 50, totalPages: 1 }),
    "GET /api/v1/courses": ok({ courses, total: 3, page: 1, limit: 200, totalPages: 1 }),
    "GET /api/v1/semesters/:id/demand": ok({ semesterId: "SEM-A", lists: 5, studentsWithLists: 5, courses: [{ courseCode: "CS101", ranked: 7, firstChoice: 3, secondChoice: 1 }] }),
    ...extra,
  });

  it("shows the profile and each ranked list with seats, demand and times", async () => {
    const { callsTo } = renderApp({ route: "/data/students/sid-1?semester=SEM-A", handlers: handlers() });
    expect(await screen.findByRole("heading", { name: "Student 1" })).toBeInTheDocument();
    expect(screen.getByText("8.10")).toBeInTheDocument();
    expect(callsTo("GET", "/api/v1/preferences")[0].query).toMatchObject({ student: "sid-1", semesterId: "SEM-A" });

    const pe1 = (await screen.findByRole("heading", { name: "Group PE1" })).closest("section");
    expect(within(pe1).getByText("Submitted")).toBeInTheDocument();
    const first = within(pe1).getByText("Machine Learning").closest("li");
    expect(first).toHaveTextContent("CS101 · 10 seats · ranked by 7");
    expect(within(first).getByText("Mon 09:00–11:00")).toBeInTheDocument();
    expect(within(first).getByLabelText("1st choice")).toBeInTheDocument();
    expect(within(pe1).getByText("Some choices overlap in time")).toBeInTheDocument();

    const oe1 = screen.getByRole("heading", { name: "Group OE1" }).closest("section");
    expect(within(oe1).getByText("Draft, not submitted")).toBeInTheDocument();
    expect(within(oe1).queryByText("Some choices overlap in time")).not.toBeInTheDocument();
  });

  it("says so when the student has not saved a list", async () => {
    renderApp({
      route: "/data/students/sid-1?semester=SEM-A",
      handlers: handlers({ "GET /api/v1/preferences": ok({ preferences: [], total: 0, page: 1, limit: 50, totalPages: 0 }) }),
    });
    expect(await screen.findByText("No preference list yet")).toBeInTheDocument();
  });

  it("shows a clear error when the student does not exist", async () => {
    renderApp({ route: "/data/students/missing", handlers: handlers({ "GET /api/v1/students/:id": fail(404, "NOT_FOUND", "Student not found.") }) });
    expect(await screen.findByText("Student not found.")).toBeInTheDocument();
  });

  it("links back to the list of the same semester", async () => {
    renderApp({ route: "/data/students/sid-1?semester=SEM-A", handlers: handlers() });
    const back = await screen.findByRole("link", { name: /All students/ });
    expect(back).toHaveAttribute("href", "/data/students?semester=SEM-A");
  });
});
