import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ADMIN, FACULTY, created, fail, fixture, ok, renderApp, summaryOf } from "../../test/utils.jsx";

const list = (patch = {}) => ({ ...fixture("runs-list").data, ...patch });
const base = () => ({
  "GET /api/v1/allocations/runs": ok(list()),
  "GET /api/v1/semesters/overview": ok(fixture("semester-overview").data),
});

describe("runs list", () => {
  it("shows every stored run with its status, algorithms and results", async () => {
    renderApp({ route: "/runs", handlers: base() });
    const table = await screen.findByRole("table", { name: /allocation runs/i });
    const rows = within(table).getAllByRole("row").slice(1); // skip the header
    expect(rows).toHaveLength(2);

    const text = rows.map((r) => r.textContent);
    expect(text.some((t) => t.includes("Published") && t.includes("Baseline") && t.includes("Optimized"))).toBe(true);
    expect(text.some((t) => t.includes("Completed"))).toBe(true);
    for (const row of rows) expect(row).toHaveTextContent("SEM-FX");
  });

  it("puts the assignment numbers beside each algorithm's swatch, with names for screen readers", async () => {
    renderApp({ route: "/runs", handlers: base() });
    const table = await screen.findByRole("table");
    const both = within(table).getAllByRole("row").find((r) => r.textContent.includes("Optimized"));
    expect(both).toHaveTextContent("Baseline: 34");
    expect(both).toHaveTextContent("Optimized: 39");
  });

  it("opens a run when its row is clicked", async () => {
    const run = list().runs[0];
    const { events } = renderApp({
      route: "/runs",
      handlers: { ...base(), "GET /api/v1/allocations/runs/:id/summary": ok(summaryOf("summary-both").run ? summaryOf("summary-both") : null) },
    });
    const table = await screen.findByRole("table");
    await events.click(within(table).getAllByRole("row")[1]);
    expect(await screen.findByRole("heading", { name: /Run for SEM-FX/ })).toBeInTheDocument();
    expect(run._id).toBeTruthy();
  });

  it("asks the server for the chosen filter and starts again from page 1", async () => {
    const { events, calls } = renderApp({ route: "/runs?page=2", handlers: base() });
    await screen.findByRole("table");
    expect(calls.filter((c) => c.path === "/api/v1/allocations/runs").at(-1).query).toMatchObject({ page: "2", limit: "15" });

    await events.selectOptions(screen.getByLabelText("Status"), "published");
    await waitFor(() => expect(calls.filter((c) => c.path === "/api/v1/allocations/runs").at(-1).query).toMatchObject({ status: "published" }));
    // a new filter always starts at the first page (and the address carries no page number)
    expect(calls.filter((c) => c.path === "/api/v1/allocations/runs").at(-1).query.page).toBe("1");

    await events.selectOptions(screen.getByLabelText("Algorithm"), "optimized");
    await waitFor(() => expect(calls.filter((c) => c.path === "/api/v1/allocations/runs").at(-1).query).toMatchObject({ status: "published", algorithm: "optimized" }));

    await events.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(calls.filter((c) => c.path === "/api/v1/allocations/runs").at(-1).query.status).toBeUndefined());
  });

  it("explains an empty history and offers the first step (admin only)", async () => {
    renderApp({ route: "/runs", handlers: { ...base(), "GET /api/v1/allocations/runs": ok(list({ runs: [], total: 0, totalPages: 0 })) } });
    expect(await screen.findByText("No runs yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start the first run" })).toHaveAttribute("href", "/runs/new");
  });

  it("does not offer to start a run to faculty", async () => {
    renderApp({ route: "/runs", user: FACULTY, handlers: { ...base(), "GET /api/v1/allocations/runs": ok(list({ runs: [], total: 0, totalPages: 0 })) } });
    expect(await screen.findByText("No runs yet")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /start the first run|new run/i })).not.toBeInTheDocument();
  });

  it("says when the filters match nothing", async () => {
    renderApp({ route: "/runs?status=failed", handlers: { ...base(), "GET /api/v1/allocations/runs": ok(list({ runs: [], total: 0, totalPages: 0 })) } });
    expect(await screen.findByText("No runs match these filters")).toBeInTheDocument();
  });

  it("shows the reason in the row of a failed run", async () => {
    const failed = { ...list().runs[0], _id: "f1", status: "failed", errorSummary: "The allocation exceeded the time limit", baselineMetrics: null, optimizedMetrics: null };
    renderApp({ route: "/runs", handlers: { ...base(), "GET /api/v1/allocations/runs": ok(list({ runs: [failed], total: 1 })) } });
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Failed")).toBeInTheDocument();
    expect(within(table).getByText("The allocation exceeded the time limit")).toBeInTheDocument();
  });

  it("paginates", async () => {
    const { events, calls } = renderApp({ route: "/runs", handlers: { ...base(), "GET /api/v1/allocations/runs": ok(list({ total: 40, totalPages: 3, limit: 15, page: 1 })) } });
    await screen.findByRole("table");
    expect(screen.getByText(/Showing/)).toHaveTextContent("1–15 of 40 runs");
    await events.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(calls.filter((c) => c.path === "/api/v1/allocations/runs").at(-1).query.page).toBe("2"));
  });

  it("shows a server error instead of an empty page", async () => {
    renderApp({ route: "/runs", handlers: { ...base(), "GET /api/v1/allocations/runs": fail(500, "INTERNAL_ERROR", "Something failed on the server.") } });
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Something failed on the server.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------
describe("new run", () => {
  // an empty semester list keeps these tests on the plain text box (the list has its own tests below)
  const withCompare = (extra = {}) => ({
    ...base(),
    "GET /api/v1/semesters/overview": ok({ semesters: [] }),
    "POST /api/v1/allocations/compare": created({ run: { ...fixture("compare-created").data.run, _id: "run-123" } }),
    "GET /api/v1/allocations/runs/:id/summary": ok(summaryOf("summary-both")),
    ...extra,
  });

  it("asks for a semester before it will run anything", async () => {
    const { events, callsTo } = renderApp({ route: "/runs/new", handlers: withCompare() });
    await events.click(await screen.findByRole("button", { name: "Run allocation" }));
    expect(await screen.findByText("Choose the semester to run.")).toBeInTheDocument();
    expect(callsTo("POST", "/api/v1/allocations/compare")).toHaveLength(0);
  });

  it("starts a comparison with the form's settings and opens the result", async () => {
    const { events, callsTo } = renderApp({ route: "/runs/new", handlers: withCompare() });
    await events.type(await screen.findByLabelText(/^semester/i), "SEM-FX");
    await events.type(screen.getByLabelText(/^lottery seed/i), "42");
    await events.click(screen.getByRole("button", { name: "Run allocation" }));

    expect(await screen.findByRole("heading", { name: /Run for SEM-FX/ })).toBeInTheDocument();
    expect(callsTo("POST", "/api/v1/allocations/compare")[0].body).toEqual({
      semesterId: "SEM-FX", maxCoursesPerStudent: 2, includeTimetable: true, meritRatio: 0.7, randomRatio: 0.3, seed: 42,
      optimizerFloor: "baseline", cgpaPriority: true,
    });
    expect(await screen.findByText("Run completed")).toBeInTheDocument();
  });

  it("lets the merit share be changed and keeps the two shares adding up", async () => {
    const { events, callsTo } = renderApp({ route: "/runs/new", handlers: withCompare() });
    await events.type(await screen.findByLabelText(/^semester/i), "SEM-FX");
    const slider = screen.getByRole("slider");
    expect(screen.getByText(/70% by CGPA merit · 30% by random lottery/)).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: "85" } });
    expect(screen.getByText(/85% by CGPA merit · 15% by random lottery/)).toBeInTheDocument();
    await events.click(screen.getByRole("button", { name: "Run allocation" }));
    await screen.findByRole("heading", { name: /Run for SEM-FX/ });
    const body = callsTo("POST", "/api/v1/allocations/compare")[0].body;
    expect(body.meritRatio).toBeCloseTo(0.85);
    expect(body.randomRatio).toBeCloseTo(0.15);
    expect(body.meritRatio + body.randomRatio).toBeCloseTo(1, 9);
  });

  it("optimized-only held to the baseline shows the baseline settings and sends them", async () => {
    const { events, callsTo } = renderApp({
      route: "/runs/new",
      handlers: withCompare({ "POST /api/v1/allocations/run": created({ run: { ...fixture("compare-created").data.run, _id: "run-8" } }) }),
    });
    await events.type(await screen.findByLabelText(/^semester/i), "SEM-FX");
    await events.click(screen.getByRole("radio", { name: "Optimized only" }));
    expect(screen.getByLabelText(/^lottery seed/i)).toBeInTheDocument();
    expect(screen.getByRole("slider")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Never leave a student worse off than the baseline" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Use CGPA to decide who gets the better choices" })).toBeChecked();
    await events.click(screen.getByRole("button", { name: "Run allocation" }));
    await screen.findByRole("heading", { name: /Run for SEM-FX/ });
    expect(callsTo("POST", "/api/v1/allocations/run")[0].body).toEqual({
      semesterId: "SEM-FX", algorithm: "optimized", maxCoursesPerStudent: 2, includeTimetable: true,
      optimizerFloor: "baseline", cgpaPriority: true, meritRatio: 0.7, randomRatio: 0.3,
    });
  });

  it("optimized-only sends no ratios or seed when it is not held to the baseline, and hides those settings", async () => {
    const { events, callsTo } = renderApp({
      route: "/runs/new",
      handlers: withCompare({ "POST /api/v1/allocations/run": created({ run: { ...fixture("compare-created").data.run, _id: "run-9" } }) }),
    });
    await events.type(await screen.findByLabelText(/^semester/i), "SEM-FX");
    await events.click(screen.getByRole("radio", { name: "Optimized only" }));
    await events.click(screen.getByRole("switch", { name: "Never leave a student worse off than the baseline" }));
    expect(screen.queryByLabelText(/lottery seed/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
    await events.click(screen.getByRole("button", { name: "Run allocation" }));
    await screen.findByRole("heading", { name: /Run for SEM-FX/ });
    expect(callsTo("POST", "/api/v1/allocations/run")[0].body).toEqual({
      semesterId: "SEM-FX", algorithm: "optimized", maxCoursesPerStudent: 2, includeTimetable: true,
      optimizerFloor: "none", cgpaPriority: true,
    });
    expect(callsTo("POST", "/api/v1/allocations/compare")).toHaveLength(0);
  });

  it("the timetable switch is sent, and the slow-optimizer hint appears only when it applies", async () => {
    const { events, callsTo } = renderApp({ route: "/runs/new", handlers: withCompare() });
    await events.type(await screen.findByLabelText(/^semester/i), "SEM-FX");
    expect(screen.getByText("The optimizer searches for the best clash-free result")).toBeInTheDocument();
    await events.click(screen.getByRole("switch", { name: "Check timetable clashes" }));
    expect(screen.queryByText("The optimizer searches for the best clash-free result")).not.toBeInTheDocument();
    await events.click(screen.getByRole("button", { name: "Run allocation" }));
    await screen.findByRole("heading", { name: /Run for SEM-FX/ });
    expect(callsTo("POST", "/api/v1/allocations/compare")[0].body.includeTimetable).toBe(false);
  });

  it("validates the seed and the course limit on screen", async () => {
    const { events, callsTo } = renderApp({ route: "/runs/new", handlers: withCompare() });
    await events.type(await screen.findByLabelText(/^semester/i), "SEM-FX");
    await events.type(screen.getByLabelText(/^lottery seed/i), "abc");
    await events.clear(screen.getByLabelText(/maximum courses/i));
    await events.type(screen.getByLabelText(/maximum courses/i), "99");
    await events.click(screen.getByRole("button", { name: "Run allocation" }));
    expect(await screen.findByText(/A seed is a whole number/)).toBeInTheDocument();
    expect(screen.getByText("Enter a whole number from 1 to 10.")).toBeInTheDocument();
    expect(callsTo("POST", "/api/v1/allocations/compare")).toHaveLength(0);
  });

  it("shows progress while the server works, and can cancel the right run", async () => {
    let finish;
    const pending = new Promise((resolve) => { finish = resolve; });
    const { events, callsTo } = renderApp({
      route: "/runs/new",
      handlers: withCompare({
        "POST /api/v1/allocations/compare": () => pending,
        // the run list tells the page which run is the live one
        "GET /api/v1/allocations/runs": ok(list({ runs: [{ _id: "live-1", status: "running", semesterId: "SEM-FX", createdAt: new Date().toISOString() }] })),
        "POST /api/v1/allocations/runs/:id/cancel": ok({ run: {}, workerStopped: true }),
      }),
    });
    await events.type(await screen.findByLabelText(/^semester/i), "SEM-FX");
    await events.click(screen.getByRole("button", { name: "Run allocation" }));

    expect(await screen.findByText("Running the allocation…")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Run in progress" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run allocation" })).not.toBeInTheDocument();

    await events.click(screen.getByRole("button", { name: "Cancel run" }));
    await waitFor(() => expect(callsTo("POST", "/api/v1/allocations/runs/live-1/cancel")).toHaveLength(1));
    expect(callsTo("GET", "/api/v1/allocations/runs").at(-1).query).toMatchObject({ status: "running", semesterId: "SEM-FX" });

    // the original request now answers "cancelled"
    finish(fail(409, "ALLOCATION_CANCELLED", "The allocation run was cancelled."));
    expect(await screen.findByText("The run was cancelled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run allocation" })).toBeInTheDocument(); // form is back, values kept
    expect(screen.getByLabelText(/^semester/i)).toHaveValue("SEM-FX");
  });

  it("says so when the run has already finished and can no longer be cancelled", async () => {
    let finish;
    const pending = new Promise((resolve) => { finish = resolve; });
    const { events } = renderApp({
      route: "/runs/new",
      handlers: withCompare({ "POST /api/v1/allocations/compare": () => pending, "GET /api/v1/allocations/runs": ok(list({ runs: [] })) }),
    });
    await events.type(await screen.findByLabelText(/^semester/i), "SEM-FX");
    await events.click(screen.getByRole("button", { name: "Run allocation" }));
    await events.click(await screen.findByRole("button", { name: "Cancel run" }));
    expect(await screen.findByText(/already finishing/)).toBeInTheDocument();
    finish(created({ run: { ...fixture("compare-created").data.run, _id: "run-123" } }));
    expect(await screen.findByRole("heading", { name: /Run for SEM-FX/ })).toBeInTheDocument();
  });

  it("explains a timeout and what to do about it", async () => {
    const { events } = renderApp({
      route: "/runs/new",
      handlers: withCompare({ "POST /api/v1/allocations/compare": fail(504, "ALLOCATION_TIMEOUT", "The allocation exceeded its time limit and was stopped.") }),
    });
    await events.type(await screen.findByLabelText(/^semester/i), "SEM-FX");
    await events.click(screen.getByRole("button", { name: "Run allocation" }));
    expect(await screen.findByText("The run took too long and was stopped")).toBeInTheDocument();
    expect(screen.getByText(/timetable check turned off/)).toBeInTheDocument();
  });

  it("lists the data problems the server found", async () => {
    const { events } = renderApp({
      route: "/runs/new",
      handlers: withCompare({ "POST /api/v1/allocations/compare": fail(400, "BAD_REQUEST", 'No submitted preferences found for semester "SEM-X".') }),
    });
    await events.type(await screen.findByLabelText(/^semester/i), "SEM-X");
    await events.click(screen.getByRole("button", { name: "Run allocation" }));
    expect(await screen.findByText(/No submitted preferences found/)).toBeInTheDocument();
  });

  it("is not available to faculty", async () => {
    renderApp({ route: "/runs/new", user: FACULTY });
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
  });

  it("admin sees the entry point in the runs page header", async () => {
    renderApp({ route: "/runs", user: ADMIN, handlers: base() });
    await screen.findByRole("table");
    expect(screen.getAllByRole("link", { name: "New run" }).length).toBeGreaterThan(0);
  });
});
