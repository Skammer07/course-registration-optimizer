import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { STUDENT, fail, fixture, ok, renderApp } from "../../test/utils.jsx";
import { StatusBanner } from "./MyResultsPage.jsx";
import { render } from "@testing-library/react";

const course = (code, title, group, preferenceRank, phase) => ({ course: { courseCode: code, title, electiveGroup: group }, preferenceRank, phase });

const noCompulsory = ok({ semesterId: "SEM-FX", department: "CSE", courses: [] });

function open({ results, status, compulsory = noCompulsory }) {
  return renderApp({
    route: "/my-results",
    user: STUDENT,
    handlers: {
      "GET /api/v1/allocations/my-results": results,
      "GET /api/v1/semesters/me/status": status,
      "GET /api/v1/courses/my-compulsory": compulsory,
    },
  });
}

describe("my results", () => {
  it("before anything is published: says so, and shows where the semester stands", async () => {
    open({ results: ok(fixture("my-results-unpublished").data), status: ok(fixture("semester-status-open").data) });
    expect(await screen.findByRole("heading", { name: "My results" })).toBeInTheDocument();
    expect(screen.getByText("Seed Student 0001 · SEED0001 · semester SEM-FX")).toBeInTheDocument();
    expect(await screen.findByText("Preferences are open")).toBeInTheDocument();
    expect(screen.getByText("Your results are not published yet")).toBeInTheDocument();
  });

  it("when published: lists each course with the student's own choice rank", async () => {
    const data = fixture("my-results-published").data;
    data.assignments = [course("SD-A1", "Seed A1", "A", 1, "merit"), course("SD-B3", "Seed B3", "B", 3, "random")];
    data.summary = { coursesAllocated: 2, maxCoursesPerStudent: 2, message: null };
    open({ results: ok(data), status: ok(fixture("semester-status-published").data) });

    expect(await screen.findByText("Results are published")).toBeInTheDocument();
    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Seed A1");
    expect(items[0]).toHaveTextContent("SD-A1 · elective group A");
    expect(items[0]).toHaveTextContent("Your 1st choice");
    expect(items[0]).toHaveTextContent("Merit");
    expect(items[1]).toHaveTextContent("Your 3rd choice");
    expect(items[1]).toHaveTextContent("Lottery");
    expect(screen.getByRole("heading", { name: /Your courses/ })).toHaveTextContent("(2 of up to 2)");
  });

  it("a course from the optimizer has no merit/lottery label (it has no such phase)", async () => {
    const data = fixture("my-results-published").data;
    data.assignments = [course("SD-A1", "Seed A1", "A", 2, null)];
    data.summary = { coursesAllocated: 1, maxCoursesPerStudent: 2, message: null };
    open({ results: ok(data), status: ok(fixture("semester-status-published").data) });
    const item = await screen.findByRole("listitem");
    expect(item).toHaveTextContent("Your 2nd choice");
    expect(item).not.toHaveTextContent(/Merit|Lottery/);
  });

  it("when published but nothing was allocated: says so kindly and points to a next step", async () => {
    open({ results: ok(fixture("my-results-published").data), status: ok(fixture("semester-status-published").data) });
    expect(await screen.findByText("No course was allocated to you in this round")).toBeInTheDocument();
    expect(screen.getByText(/No course was allocated to you in this run\. Please contact your department coordinator/)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("still shows the results if the status banner cannot be loaded", async () => {
    const data = fixture("my-results-published").data;
    data.assignments = [course("SD-A1", "Seed A1", "A", 1, "merit")];
    open({ results: ok(data), status: fail(500, "INTERNAL_ERROR", "Status unavailable") });
    expect(await screen.findByText("Seed A1")).toBeInTheDocument();
  });

  it("shows an error instead of a blank page", async () => {
    open({ results: fail(400, "BAD_REQUEST", "Your user account is not linked to a student record."), status: ok(fixture("semester-status-open").data) });
    expect(await screen.findByText("Your user account is not linked to a student record.")).toBeInTheDocument();
  });
});

describe("my results: compulsory courses", () => {
  const maths = { courseCode: "MA201", title: "Engineering Mathematics III", timetableSlots: [{ day: "Monday", start: "09:00", end: "09:50" }, { day: "Thursday", start: "15:00", end: "15:50" }] };
  const data = () => {
    const d = fixture("my-results-published").data;
    d.assignments = [course("SD-A1", "Seed A1", "A", 1, "merit")];
    d.summary = { coursesAllocated: 1, maxCoursesPerStudent: 2, message: null };
    return d;
  };

  it("lists the student's compulsory courses with their weekly times, apart from the allocated electives", async () => {
    open({ results: ok(data()), status: ok(fixture("semester-status-published").data), compulsory: ok({ semesterId: "SEM-FX", department: "CSE", courses: [maths] }) });

    const heading = await screen.findByRole("heading", { name: /Your compulsory courses/ });
    expect(heading).toHaveTextContent("(1)");
    const section = heading.closest("section");
    const item = within(section).getAllByRole("listitem")[0];
    expect(item).toHaveTextContent("Engineering Mathematics III");
    expect(item).toHaveTextContent("MA201");
    expect(item).toHaveTextContent("Compulsory");
    expect(item).toHaveTextContent("Mon 09:00–09:50");
    expect(item).toHaveTextContent("Thu 15:00–15:50");
    // the allocated elective is still in its own section
    expect(screen.getByRole("heading", { name: /Your courses/ })).toHaveTextContent("(1 of up to 2)");
  });

  it("shows them even before the results are published", async () => {
    open({ results: ok(fixture("my-results-unpublished").data), status: ok(fixture("semester-status-open").data), compulsory: ok({ semesterId: "SEM-FX", department: "CSE", courses: [maths] }) });
    expect(await screen.findByRole("heading", { name: /Your compulsory courses/ })).toBeInTheDocument();
    expect(screen.getByText("Your results are not published yet")).toBeInTheDocument();
  });

  it("shows no compulsory section when the student has none", async () => {
    open({ results: ok(data()), status: ok(fixture("semester-status-published").data) });
    expect(await screen.findByText("Seed A1")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Your compulsory courses/ })).not.toBeInTheDocument();
  });

  it("still shows the results when the compulsory list cannot be loaded", async () => {
    open({ results: ok(data()), status: ok(fixture("semester-status-published").data), compulsory: fail(500, "INTERNAL_ERROR", "Unavailable") });
    expect(await screen.findByText("Seed A1")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Your compulsory courses/ })).not.toBeInTheDocument();
  });
});

describe("status banner", () => {
  const banner = (status) => render(<StatusBanner status={status} />);

  it("says the right thing for every stage of the semester", () => {
    const { unmount } = banner({ status: "preferences-not-open", opensAt: "2026-07-01T09:00:00.000Z" });
    expect(screen.getByText("Preferences are not open yet")).toBeInTheDocument();
    expect(screen.getByText(/They open on/)).toBeInTheDocument();
    unmount();

    const b = banner({ status: "preferences-open", closesAt: "2026-07-15T12:30:00.000Z" });
    expect(screen.getByText(/until/)).toBeInTheDocument();
    b.unmount();

    const c = banner({ status: "preferences-open", closesAt: null });
    expect(screen.getByText(/announce the deadline/)).toBeInTheDocument();
    c.unmount();

    const d = banner({ status: "allocation-pending" });
    expect(screen.getByText("Preferences are closed")).toBeInTheDocument();
    d.unmount();

    banner({ status: "results-published" });
    expect(screen.getByText("Results are published")).toBeInTheDocument();
  });

  it("renders nothing for an unknown or missing status", () => {
    const { container, rerender } = banner(undefined);
    expect(container).toBeEmptyDOMElement();
    rerender(<StatusBanner status={{ status: "something-new" }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
