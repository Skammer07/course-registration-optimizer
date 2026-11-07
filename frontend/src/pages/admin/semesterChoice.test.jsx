import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { created, fail, fixture, ok, renderApp, summaryOf } from "../../test/utils.jsx";

const row = (semesterId, patch = {}) => ({
  semesterId, name: "", recordExists: false, students: 30, courses: 8, preferenceLists: 60, runs: 0, published: false, ...patch,
});
const overviewOf = (...rows) => ok({ semesters: rows });
const KEY = "course-allocation:last-semester";

const listHandlers = () => ({ "GET /api/v1/allocations/runs": ok(fixture("runs-list").data) });

function openNewRun(overview, extra = {}) {
  return renderApp({
    route: "/runs/new",
    handlers: {
      ...listHandlers(),
      "GET /api/v1/semesters/overview": overview,
      "POST /api/v1/allocations/compare": created({ run: { ...fixture("compare-created").data.run, _id: "run-123" } }),
      "GET /api/v1/allocations/runs/:id/summary": ok(summaryOf("summary-both")),
      ...extra,
    },
  });
}

beforeEach(() => window.localStorage.clear());

describe("choosing the semester on the new-run form", () => {
  it("preselects the only semester that has data, shows what it holds, and runs it without any typing", async () => {
    const { events, callsTo } = openNewRun(ok(fixture("semester-overview").data));
    const select = await screen.findByLabelText(/^semester/i);
    expect(select.tagName).toBe("SELECT");
    await waitFor(() => expect(select).toHaveValue("SEM-FX"));
    expect(screen.getByText("30 students · 8 courses · 60 submitted preference lists · 2 runs so far")).toBeInTheDocument();

    await events.click(screen.getByRole("button", { name: "Run allocation" }));
    await screen.findByRole("heading", { name: /Run for SEM-FX/ });
    expect(callsTo("POST", "/api/v1/allocations/compare")[0].body.semesterId).toBe("SEM-FX");
  });

  it("with several semesters it makes the admin choose, and says so if they forget", async () => {
    const { events, callsTo } = openNewRun(overviewOf(row("SEM-A", { students: 20 }), row("SEM-B", { students: 40 })));
    const select = await screen.findByLabelText(/^semester/i);
    expect(select).toHaveValue(""); // nothing is guessed
    expect(within(select).getByRole("option", { name: "Choose a semester…" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "SEM-B (40 students)" })).toBeInTheDocument();

    await events.click(screen.getByRole("button", { name: "Run allocation" }));
    expect(await screen.findByText("Choose the semester to run.")).toBeInTheDocument();
    expect(callsTo("POST", "/api/v1/allocations/compare")).toHaveLength(0);

    await events.selectOptions(select, "SEM-B");
    expect(screen.getByText(/40 students/, { selector: "p" })).toBeInTheDocument();
  });

  it("shows a semester's name next to its id when it has one", async () => {
    openNewRun(overviewOf(row("SEM-A", { name: "Autumn 2026", recordExists: true }), row("SEM-B")));
    const select = await screen.findByLabelText(/^semester/i);
    expect(within(select).getByRole("option", { name: "SEM-A · Autumn 2026 (30 students)" })).toBeInTheDocument();
  });

  it("preselects the semester used last time, even among several", async () => {
    window.localStorage.setItem(KEY, "SEM-B");
    openNewRun(overviewOf(row("SEM-A"), row("SEM-B")));
    const select = await screen.findByLabelText(/^semester/i);
    await waitFor(() => expect(select).toHaveValue("SEM-B"));
  });

  it("ignores a remembered semester that no longer exists", async () => {
    window.localStorage.setItem(KEY, "SEM-GONE");
    openNewRun(overviewOf(row("SEM-A"), row("SEM-B")));
    expect(await screen.findByLabelText(/^semester/i)).toHaveValue("");
  });

  it("remembers the semester after a successful run", async () => {
    const { events } = openNewRun(ok(fixture("semester-overview").data));
    const select = await screen.findByLabelText(/^semester/i);
    await waitFor(() => expect(select).toHaveValue("SEM-FX"));
    await events.click(screen.getByRole("button", { name: "Run allocation" }));
    await screen.findByRole("heading", { name: /Run for SEM-FX/ });
    expect(window.localStorage.getItem(KEY)).toBe("SEM-FX");
  });

  it("lets the admin type an id that is not in the list", async () => {
    const { events, callsTo } = openNewRun(overviewOf(row("SEM-A"), row("SEM-B")));
    await screen.findByLabelText(/^semester/i);
    await events.click(screen.getByRole("button", { name: "Enter a different semester id" }));

    const input = await screen.findByLabelText(/^semester/i);
    expect(input.tagName).toBe("INPUT");
    await events.type(input, "SEM-NEW");
    await events.click(screen.getByRole("button", { name: "Run allocation" }));
    await screen.findByRole("heading", { name: /Run for/ });
    expect(callsTo("POST", "/api/v1/allocations/compare")[0].body.semesterId).toBe("SEM-NEW");
  });

  it("switches back from typing to the list", async () => {
    const { events } = openNewRun(overviewOf(row("SEM-A"), row("SEM-B")));
    await screen.findByLabelText(/^semester/i);
    await events.click(screen.getByRole("button", { name: "Enter a different semester id" }));
    await events.click(await screen.findByRole("button", { name: "Choose from the list" }));
    expect((await screen.findByLabelText(/^semester/i)).tagName).toBe("SELECT");
  });

  it("falls back to typing when the list cannot be loaded", async () => {
    const { events, callsTo } = openNewRun(fail(500, "INTERNAL_ERROR", "boom"));
    const input = await screen.findByLabelText(/^semester/i);
    expect(input.tagName).toBe("INPUT");
    expect(screen.getByText(/No semesters with data were found/)).toBeInTheDocument();
    await events.type(input, "SEM-X");
    await events.click(screen.getByRole("button", { name: "Run allocation" }));
    await screen.findByRole("heading", { name: /Run for/ });
    expect(callsTo("POST", "/api/v1/allocations/compare")[0].body.semesterId).toBe("SEM-X");
  });

  it("falls back to typing when there are no semesters yet, and offers no switch link", async () => {
    openNewRun(overviewOf());
    const input = await screen.findByLabelText(/^semester/i);
    expect(input.tagName).toBe("INPUT");
    expect(screen.queryByRole("button", { name: /Enter a different semester id|Choose from the list/ })).not.toBeInTheDocument();
  });

  it("warns before the run when the chosen semester is missing something a run needs", async () => {
    const { events } = openNewRun(overviewOf(row("SEM-OK"), row("SEM-THIN", { courses: 0, preferenceLists: 0 })));
    const select = await screen.findByLabelText(/^semester/i);
    expect(screen.queryByText(/may not be ready to run/)).not.toBeInTheDocument();

    await events.selectOptions(select, "SEM-THIN");
    const title = await screen.findByText("SEM-THIN may not be ready to run");
    const box = title.closest("[role=alert]");
    expect(within(box).getByText("It has no active courses.")).toBeInTheDocument();
    expect(within(box).getByText("No preference lists have been submitted yet.")).toBeInTheDocument();

    await events.selectOptions(select, "SEM-OK");
    expect(screen.queryByText(/may not be ready to run/)).not.toBeInTheDocument();
  });

  it("shows a placeholder, not a text box, while the list is loading", async () => {
    let finish;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    openNewRun(() => pending);
    expect(await screen.findByRole("status", { name: "Loading semesters" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /semester/i })).not.toBeInTheDocument();
    finish(overviewOf(row("SEM-A")));
    expect((await screen.findByLabelText(/^semester/i)).tagName).toBe("SELECT");
  });
});

describe("the runs page filter", () => {
  it("offers the same semesters", async () => {
    renderApp({ route: "/runs", handlers: { ...listHandlers(), "GET /api/v1/semesters/overview": overviewOf(row("SEM-A"), row("SEM-B")) } });
    const filter = await screen.findByLabelText("Semester");
    await waitFor(() => expect(within(filter).getByRole("option", { name: "SEM-B" })).toBeInTheDocument());
    expect(within(filter).getByRole("option", { name: "All semesters" })).toBeInTheDocument();
  });
});
