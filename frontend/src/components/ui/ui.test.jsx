import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog } from "./Dialog.jsx";
import { ErrorAlert } from "./Alert.jsx";
import { Tabs } from "./Tabs.jsx";
import { Meter } from "./Misc.jsx";
import { Pagination } from "./Pagination.jsx";
import { StatusBadge } from "./Badge.jsx";
import { Field } from "./Fields.jsx";
import { ChartTooltip, buildChartData, describeChart } from "../../features/runs/MetricsChart.jsx";
import { CHART } from "../../lib/chartTheme.js";
import { summaryOf } from "../../test/utils.jsx";

function DialogHarness({ dismissible = true }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open it</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Hello" description="About to do something" dismissible={dismissible} footer={<button>Second</button>}>
        <input aria-label="inside" />
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("is labelled and described, moves focus in, and gives it back on close", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const opener = screen.getByRole("button", { name: "Open it" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Hello" });
    expect(dialog).toHaveAccessibleDescription("About to do something");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("keeps Tab inside while open, in both directions", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole("button", { name: "Open it" }));
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 8; i++) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("closes on a click outside, but not on a click inside", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole("button", { name: "Open it" }));
    await user.click(screen.getByLabelText("inside"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("dialog").parentElement); // the backdrop
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a non-dismissible dialog (an action in progress) ignores Escape and offers no close button", async () => {
    const user = userEvent.setup();
    render(<DialogHarness dismissible={false} />);
    await user.click(screen.getByRole("button", { name: "Open it" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  });

  it("stops the page behind from scrolling, and restores it", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole("button", { name: "Open it" }));
    expect(document.body.style.overflow).toBe("hidden");
    await user.keyboard("{Escape}");
    expect(document.body.style.overflow).toBe("");
  });
});

describe("ErrorAlert", () => {
  it("shows the plain title, the message, a hint, the field details and a copyable reference", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<ErrorAlert error={{ code: "IMPORT_VALIDATION_FAILED", message: "2 problem(s) found; nothing was imported.", details: [{ row: 2, column: "cgpa", message: "must be 0 to 10" }], requestId: "req-42" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The file has problems");
    expect(screen.getByText("Row 2, cgpa: must be 0 to 10")).toBeInTheDocument();
    expect(screen.getByText(/Nothing was imported/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("req-42");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("caps a long list of details and renders nothing without an error", () => {
    const details = Array.from({ length: 14 }, (_, i) => `problem ${i + 1}`);
    const { container, rerender } = render(<ErrorAlert error={{ code: "X", message: "m", details }} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(11);
    expect(screen.getByText("…and 4 more")).toBeInTheDocument();
    rerender(<ErrorAlert error={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not render markup from an error message (no HTML injection)", () => {
    render(<ErrorAlert error={{ code: "X", message: '<img src=x onerror="alert(1)"> hi' }} />);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
  });
});

describe("Tabs", () => {
  it("moves between tabs with the arrow keys, Home and End", async () => {
    const user = userEvent.setup();
    const seen = [];
    function Harness() {
      const [v, setV] = useState("a");
      return <Tabs value={v} onChange={(x) => { seen.push(x); setV(x); }} tabs={[{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }]} />;
    }
    render(<Harness />);
    screen.getByRole("tab", { name: "A" }).focus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{End}{Home}{ArrowLeft}");
    expect(seen).toEqual(["b", "c", "a", "c", "a", "c"]);
    expect(screen.getByRole("tab", { name: "C" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "A" })).toHaveAttribute("tabindex", "-1"); // roving tabindex
  });
});

describe("small pieces", () => {
  it("Meter clamps, exposes its value, and copes with a zero limit", () => {
    const { rerender } = render(<Meter value={3} max={4} label="Seats" />);
    const meter = screen.getByRole("meter", { name: "Seats" });
    expect(meter).toHaveAttribute("aria-valuenow", "3");
    expect(meter.firstChild.style.width).toBe("75%");
    rerender(<Meter value={9} max={4} label="Seats" />);
    expect(screen.getByRole("meter").firstChild.style.width).toBe("100%");
    rerender(<Meter value={2} max={0} label="Seats" />);
    expect(screen.getByRole("meter").firstChild.style.width).toBe("0%");
  });

  it("Pagination shows the range, disables the ends, and hides itself when empty", async () => {
    const user = userEvent.setup();
    const onPage = vi.fn();
    const { rerender, container } = render(<Pagination page={1} limit={25} total={140} totalPages={6} onPage={onPage} noun="students" />);
    expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 1–25 of 140 students");
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onPage).toHaveBeenCalledWith(2);
    rerender(<Pagination page={6} limit={25} total={140} totalPages={6} onPage={onPage} />);
    expect(screen.getByText(/Showing/)).toHaveTextContent("126–140 of 140");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    rerender(<Pagination page={1} limit={25} total={0} totalPages={0} onPage={onPage} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<Pagination page={1} limit={25} total={10} totalPages={1} onPage={onPage} />);
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument(); // one page: no controls
  });

  it("StatusBadge always carries a word, never colour alone", () => {
    const labels = ["pending", "running", "completed", "publishing", "published", "failed", "cancelled", "mystery"].map((status) => {
      const { unmount, container } = render(<StatusBadge status={status} />);
      const text = container.textContent;
      unmount();
      return text;
    });
    expect(labels).toEqual(["Pending", "Running", "Completed", "Publishing", "Published", "Failed", "Cancelled", "mystery"]);
  });

  it("Field ties label, hint and error to the control", () => {
    render(<Field label="Seed" hint="A whole number" error="Not a number">{(a11y) => <input {...a11y} />}</Field>);
    const input = screen.getByLabelText("Seed");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Not a number");
  });
});

describe("chart data", () => {
  it("builds one row per count metric from the run summary", () => {
    const rows = buildChartData(summaryOf("summary-both"));
    expect(rows.map((r) => r.key)).toEqual(["totalAssignments", "studentsWithAtLeastOneCourse", "studentsWithTwoCourses", "unallocatedStudents", "rank1Assignments", "rank2Assignments"]);
    expect(rows[0]).toMatchObject({ label: "Assignments made", baseline: 34, optimized: 39 });
    expect(rows.every((r) => Number.isInteger(r.baseline) && Number.isInteger(r.optimized))).toBe(true); // counts only: one axis, one unit
  });

  it("describes the chart in words for screen readers", () => {
    const text = describeChart(buildChartData(summaryOf("summary-both")));
    expect(text).toMatch(/^Bar chart comparing baseline and optimized\./);
    expect(text).toContain("Students with no course: baseline 3, optimized 9.");
  });

  it("the tooltip leads with the value and names each series", () => {
    render(
      <ChartTooltip active label="Assignments made" payload={[{ dataKey: "baseline", value: 34, color: "#2a78d6" }, { dataKey: "optimized", value: 39, color: "#eb6834" }]} />
    );
    expect(screen.getByText("Assignments made")).toBeInTheDocument();
    expect(screen.getByText("34").nextSibling).toHaveTextContent("Baseline");
    expect(screen.getByText("39").nextSibling).toHaveTextContent("Optimized");
  });

  it("the tooltip renders nothing when inactive or empty", () => {
    const { container, rerender } = render(<ChartTooltip active={false} payload={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ChartTooltip active payload={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("uses the same colours the design tokens declare (JS and CSS must not drift apart)", () => {
    const css = readFileSync(resolve(__dirname, "../../index.css"), "utf8");
    const token = (name) => new RegExp("--color-" + name + ":\\s*(#[0-9a-fA-F]{6})").exec(css)?.[1]?.toLowerCase();
    expect(token("baseline")).toBe(CHART.baseline);
    expect(token("optimized")).toBe(CHART.optimized);
    expect(token("surface")).toBe(CHART.surface);
    expect(token("ink")).toBe(CHART.ink);
    expect(token("ink-2")).toBe(CHART.inkSecondary);
    expect(token("muted")).toBe(CHART.muted);
    expect(token("line")).toBe(CHART.grid);
    expect(token("line-strong")).toBe(CHART.axis);
  });
});
