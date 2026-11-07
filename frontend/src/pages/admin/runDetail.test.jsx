import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { FACULTY, csvFile, fail, fixture, ok, renderApp, summaryOf } from "../../test/utils.jsx";

vi.mock("../../lib/download.js", () => ({ saveBlob: vi.fn() }));
import { saveBlob } from "../../lib/download.js";

const emptyList = ok({ runs: [], total: 0, page: 1, limit: 15, totalPages: 0 });

function openRun({ summary = summaryOf("summary-both"), tab, alg, extra = {}, user } = {}) {
  const query = [tab && `tab=${tab}`, alg && `alg=${alg}`].filter(Boolean).join("&");
  return renderApp({
    route: `/runs/${summary.run.id}${query ? `?${query}` : ""}`,
    user,
    handlers: {
      "GET /api/v1/allocations/runs/:id/summary": ok(summary),
      "GET /api/v1/allocations/runs": emptyList,
      "GET /api/v1/semesters/overview": ok(fixture("semester-overview").data),
      ...extra,
    },
  });
}

const card = (region, label) => within(region).getByText(label, { selector: "p" }).parentElement;

beforeEach(() => vi.mocked(saveBlob).mockClear());

describe("comparison overview", () => {
  it("leads with the run's identity: semester, status, when, how long, seed and version", async () => {
    openRun();
    const heading = await screen.findByRole("heading", { name: /Run for SEM-FX/ });
    expect(within(heading).getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText(/seed 7/)).toBeInTheDocument();
    expect(screen.getByText(/version 1\.1\.0/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All runs" })).toHaveAttribute("href", "/runs");
  });

  it("shows both algorithms' numbers side by side in the headline cards", async () => {
    openRun();
    const region = await screen.findByRole("region", { name: "Headline numbers" });

    const assignments = card(region, "Assignments made");
    expect(within(assignments).getByText("34")).toBeInTheDocument();
    expect(within(assignments).getByText("39")).toBeInTheDocument();
    expect(assignments).toHaveTextContent("+5");

    const rank = card(region, "Average preference rank");
    expect(rank).toHaveTextContent("1.41");
    expect(rank).toHaveTextContent("−0.36");

    // metrics hold a percentage already: 87.18 -> 87.2%, never 8,718%
    const util = card(region, "Seat utilization");
    expect(util).toHaveTextContent("87.2%");
    expect(util).toHaveTextContent("+12.8 pts");
  });

  it("says which way each difference points without relying on colour alone", async () => {
    openRun();
    const region = await screen.findByRole("region", { name: "Headline numbers" });

    // the optimizer makes more assignments, but leaves more students with nothing
    const better = card(region, "Assignments made");
    expect(better).toHaveTextContent("(better for this metric)");
    expect(within(better).getByText(/\+5/).closest("span")).toHaveClass("text-good-ink");

    const worse = card(region, "Students with no course");
    expect(worse).toHaveTextContent("+6");
    expect(worse).toHaveTextContent("(worse for this metric)");
    expect(within(worse).getByText(/\+6/).closest("span")).toHaveClass("text-critical-ink");
  });

  it("states the policy difference and declares no winner", async () => {
    openRun();
    expect(await screen.findByText("Two different policies: no winner is declared")).toBeInTheDocument();
    expect(screen.getByText(/the baseline keeps merit\/random quotas; the optimizer maximizes assignments and ignores quotas and CGPA/)).toBeInTheDocument();
  });

  it("surfaces the run's own warnings", async () => {
    openRun();
    expect(await screen.findByText("Heads-up")).toBeInTheDocument();
    expect(screen.getByText(/Preferences are still open for this semester/)).toBeInTheDocument();
  });

  it("draws the chart with a legend, a text alternative and a pointer to the table", async () => {
    openRun();
    const chart = await screen.findByRole("img", { name: /Bar chart comparing baseline and optimized/ });
    expect(chart.getAttribute("aria-label")).toContain("Assignments made: baseline 34, optimized 39.");
    expect(chart.getAttribute("aria-label")).toContain("Students with no course: baseline 3, optimized 9.");
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(within(legend).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Baseline", "Optimized"]);
    expect(screen.getByText("The same numbers are in the table below.")).toBeInTheDocument();
  });

  it("repeats every number in a table, with the difference as optimized minus baseline", async () => {
    openRun();
    const table = await screen.findByRole("table", { name: /All metrics for both algorithms/ });
    const row = (name) => within(table).getByRole("row", { name: new RegExp(name) });

    expect(row("Assignments made")).toHaveTextContent(/34.*39.*\+5/);
    expect(row("Seat utilization")).toHaveTextContent(/87\.2%.*100\.0%.*\+12\.8 pts/);
    expect(row("Average preference rank")).toHaveTextContent(/1\.41.*1\.05.*−0\.36/);
    expect(row("Rule violations")).toHaveTextContent(/0.*0.*0/); // zero difference reads as plain 0
    expect(within(table).getAllByRole("row").length).toBeGreaterThanOrEqual(9);
    // second-choice and two-course counts have no better/worse
    expect(row("Students with two courses")).toHaveTextContent("(no better or worse)");
  });

  it("describes how each algorithm behaved, from the run's own policy details", async () => {
    openRun();
    await screen.findByRole("heading", { name: /Run for SEM-FX/ });
    expect(screen.getByText("26 by merit · 8 by lottery")).toBeInTheDocument();
    expect(screen.getByText("Not preserved (CGPA is ignored)")).toBeInTheDocument();
    expect(screen.getByText(/Unused merit quota does not transfer to the random phase\./)).toBeInTheDocument();
    expect(screen.getAllByText("Passed validation")).toHaveLength(2);
  });

  it("shows a validation failure with its reasons", async () => {
    const summary = summaryOf("summary-both");
    summary.algorithms.optimized.validation = { valid: false, errorCount: 2, errorList: ['Course "C1" exceeds capacity: 5/4.', "Student S1 has a clash."] };
    openRun({ summary });
    expect(await screen.findByText("2 validation errors")).toBeInTheDocument();
    expect(screen.getByText('Course "C1" exceeds capacity: 5/4.')).toBeInTheDocument();
  });
});

describe("other kinds of run", () => {
  it("a one-algorithm run shows its numbers and how to get the comparison", async () => {
    openRun({ summary: summaryOf("summary-single") });
    expect(await screen.findByText("This run contains only the baseline algorithm")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Run both" })).toHaveAttribute("href", "/runs/new");
    expect(screen.queryByRole("img", { name: /Bar chart/ })).not.toBeInTheDocument();
    expect(card(screen.getByRole("region", { name: "Headline numbers" }), "Assignments made")).toHaveTextContent("34");
  });

  it("a published run says what is published and offers no way to publish again", async () => {
    openRun({ summary: summaryOf("summary-published") });
    const heading = await screen.findByRole("heading", { name: /Run for SEM-FX/ });
    expect(within(heading).getByText("Published")).toBeInTheDocument();
    expect(screen.getByText(/published:/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Publish/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument(); // kept for audit
  });

  it("a failed run explains itself and has no results tabs", async () => {
    const summary = summaryOf("summary-both", { run: { status: "failed", errorSummary: "The allocation exceeded its time limit and was stopped." }, algorithms: { baseline: null, optimized: null }, comparison: { available: false, difference: null, note: "", warnings: [] } });
    openRun({ summary });
    expect(await screen.findByText("This run failed")).toBeInTheDocument();
    expect(screen.getAllByText("The allocation exceeded its time limit and was stopped.").length).toBeGreaterThan(0);
    expect(screen.getByText("No results to show")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Students" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Export CSV/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("a run still being computed says so, can be cancelled, and refreshes itself", async () => {
    const summary = summaryOf("summary-both", { run: { status: "running" }, algorithms: { baseline: null, optimized: null }, comparison: { available: false, difference: null, note: "", warnings: [] } });
    openRun({ summary });
    expect(await screen.findByText("This run is still being computed")).toBeInTheDocument();
    expect(screen.getByText("This page updates by itself.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel run" })).toBeInTheDocument();
  });

  it("a cancelled run says nothing was stored", async () => {
    const summary = summaryOf("summary-both", { run: { status: "cancelled" }, algorithms: { baseline: null, optimized: null }, comparison: { available: false, difference: null, note: "", warnings: [] } });
    openRun({ summary });
    expect(await screen.findByText("This run was cancelled")).toBeInTheDocument();
  });

  it("an unknown run is a clear page with a way back", async () => {
    renderApp({ route: "/runs/does-not-exist", handlers: { "GET /api/v1/allocations/runs/:id/summary": fail(404, "NOT_FOUND", "Allocation run not found") } });
    expect(await screen.findByText("Run not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to all runs" })).toHaveAttribute("href", "/runs");
  });

  it("any other error is shown, not swallowed", async () => {
    renderApp({ route: "/runs/x", handlers: { "GET /api/v1/allocations/runs/:id/summary": fail(500, "INTERNAL_ERROR", "Boom.") } });
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });
});

describe("what each role can do", () => {
  it("an admin sees every action on a finished, unpublished run", async () => {
    openRun();
    await screen.findByRole("heading", { name: /Run for SEM-FX/ });
    expect(screen.getByText("Export CSV")).toBeInTheDocument(); // a menu (<summary>) because the run holds two algorithms
    for (const name of ["Verify", "Delete", /Publish/]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
  });

  it("faculty can read and export, nothing else", async () => {
    openRun({ user: FACULTY });
    await screen.findByRole("heading", { name: /Run for SEM-FX/ });
    expect(screen.getByText("Export CSV")).toBeInTheDocument();
    for (const name of ["Verify", "Delete", /Publish/, "Cancel run"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  });
});

describe("publishing", () => {
  const publishHandlers = (extra = {}) => ({ "POST /api/v1/allocations/runs/:id/publish": ok({ run: {} }), ...extra });

  it("makes the admin choose, explains the consequence, then publishes exactly that algorithm", async () => {
    const { events, callsTo } = openRun({ extra: publishHandlers() });
    await events.click(await screen.findByRole("button", { name: /Publish/ }));
    const dialog = await screen.findByRole("dialog", { name: "Publish results" });

    expect(within(dialog).getByText("This cannot be undone")).toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Publish" });
    expect(confirm).toBeDisabled(); // nothing chosen yet

    expect(within(dialog).getByRole("radio", { name: /Optimized/ })).toHaveTextContent("39 assignments");
    expect(within(dialog).getByRole("radio", { name: /Optimized/ })).toHaveTextContent("9 students without a course");

    await events.click(within(dialog).getByRole("radio", { name: /Baseline/ }));
    await events.click(within(dialog).getByRole("button", { name: "Publish baseline results" }));

    await waitFor(() => expect(callsTo("POST", `/api/v1/allocations/runs/${summaryOf("summary-both").run.id}/publish`)).toHaveLength(1));
    expect(callsTo("POST", `/api/v1/allocations/runs/${summaryOf("summary-both").run.id}/publish`)[0].body).toEqual({ algorithm: "baseline" });
    expect(await screen.findByText("Results published")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Publish results" })).not.toBeInTheDocument());
  });

  it("cannot publish an algorithm that failed validation, and pre-selects the only one that passed", async () => {
    const summary = summaryOf("summary-both");
    summary.algorithms.optimized.validation = { valid: false, errorCount: 1, errorList: ["bad"] };
    const { events } = openRun({ summary, extra: publishHandlers() });
    await events.click(await screen.findByRole("button", { name: /Publish/ }));
    const dialog = await screen.findByRole("dialog", { name: "Publish results" });
    expect(within(dialog).getByRole("radio", { name: /Optimized/ })).toBeDisabled();
    expect(within(dialog).getByRole("radio", { name: /Baseline/ })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByRole("button", { name: "Publish baseline results" })).toBeEnabled();
  });

  it("offers no publish button when nothing passed validation", async () => {
    const summary = summaryOf("summary-both");
    for (const a of ["baseline", "optimized"]) summary.algorithms[a].validation = { valid: false, errorCount: 1, errorList: ["bad"] };
    openRun({ summary });
    await screen.findByRole("heading", { name: /Run for SEM-FX/ });
    expect(screen.queryByRole("button", { name: /Publish/ })).not.toBeInTheDocument();
  });

  it("shows why the server refused, and stays open to try again", async () => {
    const { events } = openRun({
      extra: publishHandlers({ "POST /api/v1/allocations/runs/:id/publish": fail(422, "PUBLICATION_VALIDATION_FAILED", "Cannot publish the baseline results.", ["Student S1 exceeds the limit"]) }),
    });
    await events.click(await screen.findByRole("button", { name: /Publish/ }));
    const dialog = await screen.findByRole("dialog", { name: "Publish results" });
    await events.click(within(dialog).getByRole("radio", { name: /Baseline/ }));
    await events.click(within(dialog).getByRole("button", { name: "Publish baseline results" }));
    expect(await within(dialog).findByText("These results cannot be published")).toBeInTheDocument();
    expect(within(dialog).getByText("Student S1 exceeds the limit")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Publish baseline results" })).toBeEnabled();
  });

  it("closes with Escape and returns focus to the button that opened it", async () => {
    const { events } = openRun();
    const opener = await screen.findByRole("button", { name: /Publish/ });
    await events.click(opener);
    await screen.findByRole("dialog", { name: "Publish results" });
    await events.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });
});

describe("verify, delete, cancel and export", () => {
  const id = () => summaryOf("summary-both").run.id;

  it("verify replays the run and reports the result per algorithm", async () => {
    const { events, callsTo } = openRun({ extra: { "POST /api/v1/allocations/runs/:id/verify": ok(fixture("verify").data) } });
    await events.click(await screen.findByRole("button", { name: "Verify" }));
    const dialog = await screen.findByRole("dialog", { name: "Verify this run" });
    expect(await within(dialog).findByText("The stored results can be reproduced exactly")).toBeInTheDocument();
    expect(within(dialog).getAllByText("Identical")).toHaveLength(2);
    expect(within(dialog).getByText(/34 stored · 34 replayed · seed 7 · version 1\.1\.0/)).toBeInTheDocument();
    expect(callsTo("POST", `/api/v1/allocations/runs/${id()}/verify`)).toHaveLength(1);
  });

  it("verify explains a difference instead of hiding it", async () => {
    const data = fixture("verify").data;
    data.allMatch = false;
    data.results[0] = { ...data.results[0], matches: false, replayedCount: 33, onlyInStored: [{ studentId: "S1" }], onlyInReplay: [], sameVersion: false, currentVersion: "9.9.9", note: "The algorithm version differs." };
    const { events } = openRun({ extra: { "POST /api/v1/allocations/runs/:id/verify": ok(data) } });
    await events.click(await screen.findByRole("button", { name: "Verify" }));
    const dialog = await screen.findByRole("dialog", { name: "Verify this run" });
    expect(await within(dialog).findByText("The replay did not match everywhere")).toBeInTheDocument();
    expect(within(dialog).getByText("Differs")).toBeInTheDocument();
    expect(within(dialog).getByText("The algorithm version differs.")).toBeInTheDocument();
    expect(within(dialog).getByText(/1 only in the stored results · 0 only in the replay/)).toBeInTheDocument();
  });

  it("delete asks first, then removes the run and returns to the list", async () => {
    const { events, callsTo } = openRun({ extra: { "DELETE /api/v1/allocations/runs/:id": ok({ id: id() }) } });
    await events.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this run?" });
    expect(callsTo("DELETE", `/api/v1/allocations/runs/${id()}`)).toHaveLength(0); // not yet
    await events.click(within(dialog).getByRole("button", { name: "Delete run" }));
    expect(await screen.findByRole("heading", { name: "Allocation runs" })).toBeInTheDocument();
    expect(callsTo("DELETE", `/api/v1/allocations/runs/${id()}`)).toHaveLength(1);
    expect(await screen.findByText("Run deleted")).toBeInTheDocument();
  });

  it("'Keep as is' leaves everything untouched", async () => {
    const { events, callsTo } = openRun();
    await events.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this run?" });
    await events.click(within(dialog).getByRole("button", { name: "Keep as is" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(callsTo("DELETE", `/api/v1/allocations/runs/${id()}`)).toHaveLength(0);
  });

  it("shows the server's reason when a delete is refused", async () => {
    const { events } = openRun({ extra: { "DELETE /api/v1/allocations/runs/:id": fail(409, "CONFLICT", "A run with status \"published\" cannot be deleted.") } });
    await events.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this run?" });
    await events.click(within(dialog).getByRole("button", { name: "Delete run" }));
    expect(await within(dialog).findByText(/A run with status/)).toBeInTheDocument();
  });

  it("cancelling a running run asks first", async () => {
    const summary = summaryOf("summary-both", { run: { status: "running" }, algorithms: { baseline: null, optimized: null }, comparison: { available: false, difference: null, note: "", warnings: [] } });
    const { events, callsTo } = openRun({ summary, extra: { "POST /api/v1/allocations/runs/:id/cancel": ok({ run: {}, workerStopped: true }) } });
    await events.click(await screen.findByRole("button", { name: "Cancel run" }));
    const dialog = await screen.findByRole("dialog", { name: "Cancel this run?" });
    await events.click(within(dialog).getByRole("button", { name: "Cancel the run" }));
    await waitFor(() => expect(callsTo("POST", `/api/v1/allocations/runs/${id()}/cancel`)).toHaveLength(1));
  });

  it("exports the chosen algorithm as a CSV download", async () => {
    const { events, callsTo } = openRun({ extra: { "GET /api/v1/allocations/runs/:id/export": csvFile("a,b\n1,2\n", "allocation-SEM-FX-baseline-abc123.csv") } });
    await events.click(await screen.findByText("Export CSV"));
    await events.click(screen.getByRole("button", { name: /Baseline \(merit/ }));
    await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1));
    expect(callsTo("GET", `/api/v1/allocations/runs/${id()}/export`)[0].query).toEqual({ algorithm: "baseline" });
    expect(vi.mocked(saveBlob).mock.calls[0][1]).toBe("allocation-SEM-FX-baseline-abc123.csv");
  });

  it("a one-algorithm run exports with a single click", async () => {
    const { events, callsTo } = openRun({ summary: summaryOf("summary-single"), extra: { "GET /api/v1/allocations/runs/:id/export": csvFile("x\n") } });
    await events.click(await screen.findByRole("button", { name: "Export CSV" }));
    await waitFor(() => expect(saveBlob).toHaveBeenCalled());
    expect(callsTo("GET", `/api/v1/allocations/runs/${summaryOf("summary-single").run.id}/export`)[0].query.algorithm).toBe("baseline");
  });

  it("tells the user when an export fails", async () => {
    const { events } = openRun({ summary: summaryOf("summary-single"), extra: { "GET /api/v1/allocations/runs/:id/export": fail(500, "INTERNAL_ERROR", "Export blew up.") } });
    await events.click(await screen.findByRole("button", { name: "Export CSV" }));
    expect(await screen.findByText("Export failed")).toBeInTheDocument();
    expect(saveBlob).not.toHaveBeenCalled();
  });
});

describe("students tab", () => {
  const byStudent = (patch = {}) => ({ "GET /api/v1/allocations/runs/:id/results/by-student": (call) => ok({ ...fixture("by-student").data, ...patch, algorithm: call.query.algorithm }) });
  const last = (mock) => mock.calls.filter((c) => c.path.endsWith("/results/by-student")).at(-1);

  it("lists students with the courses they were given and how they ranked them", async () => {
    openRun({ tab: "students", extra: byStudent() });
    const table = await screen.findByRole("table", { name: /Students and the courses they were given/ });
    const first = within(table).getAllByRole("row")[1];
    expect(first).toHaveTextContent("Seed Student 0030");
    expect(first).toHaveTextContent("SEED0030");
    expect(first).toHaveTextContent("9.80");
    expect(within(first).getByLabelText(/Seed A4 · 1st choice in A · merit, round 1/)).toBeInTheDocument();
    expect(first).toHaveTextContent("1 course");
  });

  it("shows what the other algorithm gave, only where the two results differ", async () => {
    const data = fixture("by-student").data;
    const [a, b] = data.students;
    const course = (code) => ({ courseCode: code, title: code, electiveGroup: "A", preferenceRank: 2, phase: null, iteration: null });
    const students = [
      { ...a, differs: true, other: { algorithm: "optimized", courses: [course("ZZ-9")], coursesAllocated: 1, averageRank: 2 } },
      { ...b, differs: false, other: { algorithm: "optimized", courses: b.courses, coursesAllocated: b.coursesAllocated, averageRank: b.averageRank } },
    ];
    openRun({
      tab: "students",
      alg: "baseline",
      extra: byStudent({ students, compare: { available: true, otherAlgorithm: "optimized", differing: 1, total: 2 } }),
    });
    const table = await screen.findByRole("table", { name: /Students and the courses they were given/ });
    expect(screen.getByRole("status")).toHaveTextContent(/1 of 2 students get different courses/);
    // one column per algorithm; there is no separate algorithm switch on this tab
    expect(within(table).getByRole("columnheader", { name: /^Baseline.*choice rank/ })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /^Optimized.*choice rank/ })).toBeInTheDocument();
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("ZZ-9");
    expect(rows[1]).toHaveTextContent("Worse");
    expect(rows[2]).toHaveTextContent("Same");
    expect(screen.getByRole("option", { name: "Different in the two algorithms" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Algorithm" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Sort: best average rank · Optimized" })).toBeInTheDocument();
  });

  it("says whether the optimizer's result is better or worse for each student", async () => {
    const data = fixture("by-student").data;
    const [a, b] = data.students;
    const one = (code, rank) => ({ courseCode: code, title: code, electiveGroup: "A", preferenceRank: rank, phase: null, iteration: null });
    const students = [
      // baseline 4.00 -> optimized 1.00: improved
      { ...a, courses: [one("B-1", 4)], coursesAllocated: 1, averageRank: 4, differs: true, other: { algorithm: "optimized", courses: [one("O-1", 1)], coursesAllocated: 1, averageRank: 1 } },
      // baseline 1 course -> optimized none: worse
      { ...b, courses: [one("B-2", 1)], coursesAllocated: 1, averageRank: 1, differs: true, other: { algorithm: "optimized", courses: [], coursesAllocated: 0, averageRank: null } },
    ];
    openRun({ tab: "students", alg: "baseline", extra: byStudent({ students, compare: { available: true, otherAlgorithm: "optimized", differing: 2, total: 2 } }) });
    const table = await screen.findByRole("table", { name: /Students and the courses they were given/ });
    const rows = within(table).getAllByRole("row");
    expect(rows[1]).toHaveTextContent("Improved");
    expect(rows[1]).toHaveTextContent("avg rank 4.00 → 1.00");
    expect(rows[2]).toHaveTextContent("Worse");
    expect(rows[2]).toHaveTextContent("1 → 0 courses");
  });

  it("marks students who got nothing, instead of leaving a blank", async () => {
    const data = fixture("by-student").data;
    data.students.push({ studentId: "SEED0099", name: "Seed Student 0099", cgpa: 6.1, courses: [], coursesAllocated: 0, averageRank: null, status: "unallocated" });
    openRun({ tab: "students", extra: byStudent({ students: data.students }) });
    const table = await screen.findByRole("table");
    const row = within(table).getByRole("row", { name: /Seed Student 0099/ });
    expect(row).toHaveTextContent("None");
    expect(row).toHaveTextContent("No course");
  });

  it("uses the published algorithm by default, and an algorithm-specific sort switches to that algorithm", async () => {
    const { events, ...mock } = openRun({ summary: summaryOf("summary-published"), tab: "students", extra: byStudent() });
    await screen.findByRole("table");
    expect(last(mock).query.algorithm).toBe("baseline");
    await events.selectOptions(screen.getByLabelText("Sort by"), "averageRank@optimized");
    await waitFor(() => expect(last(mock).query).toMatchObject({ algorithm: "optimized", sort: "averageRank" }));
  });

  it("searches after the typing pauses, and filters and sorts on the server", async () => {
    const { events, ...mock } = openRun({ tab: "students", extra: byStudent() });
    await screen.findByRole("table");
    await events.type(screen.getByRole("searchbox", { name: "Search students" }), "ravi");
    await waitFor(() => expect(last(mock).query.search).toBe("ravi"));

    await events.selectOptions(screen.getByLabelText("Show"), "differs");
    await waitFor(() => expect(last(mock).query.status).toBe("differs"));
    await events.selectOptions(screen.getByLabelText("Sort by"), "cgpa");
    await waitFor(() => expect(last(mock).query).toMatchObject({ search: "ravi", status: "differs", sort: "cgpa", page: "1" }));
  });

  it("says when nothing matches the filter", async () => {
    const { events } = openRun({ tab: "students", extra: byStudent({ students: [], total: 0, totalPages: 0 }) });
    await screen.findByText("No students in this run");
    await events.type(screen.getByRole("searchbox", { name: "Search students" }), "zzz");
    expect(await screen.findByText("No students match")).toBeInTheDocument();
  });

  it("pages through the students", async () => {
    const { events, ...mock } = openRun({ tab: "students", extra: byStudent() });
    await screen.findByRole("table");
    const summary = screen.getAllByText(/Showing/).find((el) => el.tagName === "P");
    expect(summary).toHaveTextContent("Showing 1–12 of 30 students");
    await events.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(last(mock).query.page).toBe("2"));
  });

  it("keeps the tab in the address, so a link opens the same view", async () => {
    const { events } = openRun({ extra: byStudent() });
    await events.click(await screen.findByRole("tab", { name: "Students" }));
    expect(await screen.findByRole("table", { name: /Students and the courses/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Students" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("courses tab", () => {
  const byCourse = { "GET /api/v1/allocations/runs/:id/results/by-course": ok(fixture("by-course").data) };

  it("shows how full each course is, how many wanted it, and how seats were given", async () => {
    openRun({ tab: "courses", extra: byCourse });
    const table = await screen.findByRole("table", { name: /Courses with seats filled and demand/ });
    const row = within(table).getByRole("row", { name: /SD-A1/ });
    expect(row).toHaveTextContent("4/4");
    expect(row).toHaveTextContent("100%");
    expect(row).toHaveTextContent("27 students");
    expect(row).toHaveTextContent("3 merit · 1 lottery");
    expect(within(row).getByRole("meter", { name: "SD-A1 seats filled" })).toHaveAttribute("aria-valuenow", "4");
  });

  it("reveals who got a course on request", async () => {
    const { events } = openRun({ tab: "courses", extra: byCourse });
    const table = await screen.findByRole("table");
    const row = within(table).getByRole("row", { name: /SD-A1/ });
    const toggle = within(row).getByRole("button", { name: /Show students/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await events.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(table).getByText("Seed Student 0005", { exact: false })).toBeInTheDocument();
    await events.click(toggle);
    expect(within(table).queryByText("Seed Student 0005", { exact: false })).not.toBeInTheDocument();
  });

  it("sorts on the server", async () => {
    const { events, calls } = openRun({ tab: "courses", extra: byCourse });
    await screen.findByRole("table");
    await events.selectOptions(screen.getByLabelText("Sort by"), "demand");
    await waitFor(() => expect(calls.filter((c) => c.path.endsWith("/results/by-course")).at(-1).query.sort).toBe("demand"));
  });
});

describe("details tab", () => {
  it("lists the settings and inputs needed to understand and reproduce the run", async () => {
    openRun({ tab: "details" });
    expect(await screen.findByText("Settings used")).toBeInTheDocument();
    expect(screen.getByText("75% merit · 25% lottery")).toBeInTheDocument();
    expect(screen.getByText("Timetable clash check").nextSibling).toHaveTextContent("On");
    expect(screen.getAllByText("Students").find((el) => el.tagName === "DT").nextSibling).toHaveTextContent("30");
    expect(screen.getByText("Preference entries").nextSibling).toHaveTextContent("175");
    expect(screen.getByText(/same data, settings, seed and algorithm version give the same baseline result/)).toBeInTheDocument();
  });

  it("falls back to the overview for a tab that does not exist or has no data", async () => {
    openRun({ tab: "nonsense" });
    expect(await screen.findByText("Two different policies: no winner is declared")).toBeInTheDocument();
  });
});
