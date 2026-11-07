import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AlgorithmCard, BaselineEvidence } from "./ComparisonOverview.jsx";

const evidence = (patch = {}) => ({
  slots: 200, better: 34, same: 166, worse: 0, gained: 0,
  topCgpa: { students: 20, baselineAverageRank: 1.05, optimizedAverageRank: 1.05 },
  others: { students: 80, baselineAverageRank: 2.43, optimizedAverageRank: 1.3 },
  worstRank: { baseline: 15, optimized: 3 },
  cgpaPriorityViolations: { baseline: 157, optimized: 43 },
  heldToBaseline: true,
  ...patch,
});

describe("baseline evidence panel", () => {
  it("says plainly that nobody ends worse, and shows the numbers", () => {
    render(<BaselineEvidence evidence={evidence()} />);

    expect(screen.getByText("No student ends worse than under the baseline")).toBeInTheDocument();
    const tiles = screen.getByRole("region", { name: "Better, same and worse than the baseline" });
    expect(within(tiles).getByText("Better").closest("div")).toHaveTextContent("34");
    expect(within(tiles).getByText("Same").closest("div")).toHaveTextContent("166");
    expect(within(tiles).getByText("Worse").closest("div")).toHaveTextContent("0");

    expect(screen.getByText("Average rank, 20 students with the highest CGPA").closest("div")).toHaveTextContent("1.05 → 1.05");
    expect(screen.getByText("Average rank, the other 80 students").closest("div")).toHaveTextContent("2.43 → 1.3");
    expect(screen.getByText("Lowest choice anyone was given (worst rank)").closest("div")).toHaveTextContent("15 → 3");
    expect(screen.getByText("CGPA-priority violations").closest("div")).toHaveTextContent("157 → 43");
  });

  it("warns when the optimizer was meant to be held to the baseline but some results are worse", () => {
    render(<BaselineEvidence evidence={evidence({ worse: 3, better: 30, same: 167 })} />);
    expect(screen.getByText("3 of the baseline's results are worse in the optimized allocation")).toBeInTheDocument();
    expect(screen.getByText(/meant to be held to the baseline/)).toBeInTheDocument();
    expect(screen.queryByText("No student ends worse than under the baseline")).not.toBeInTheDocument();
  });

  it("explains worse results when the optimizer was not held to the baseline", () => {
    render(<BaselineEvidence evidence={evidence({ worse: 18, heldToBaseline: false })} />);
    expect(screen.getByText(/was not held to the baseline in this run/)).toBeInTheDocument();
  });

  it("makes no claim when the optimizer was not held to the baseline and nobody is worse", () => {
    render(<BaselineEvidence evidence={evidence({ heldToBaseline: false })} />);
    expect(screen.queryByText("No student ends worse than under the baseline")).not.toBeInTheDocument();
  });

  it("shows nothing when there is no evidence", () => {
    const { container } = render(<BaselineEvidence evidence={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("the optimizer's details say whether it was held to the baseline and whether it used CGPA", () => {
    const side = {
      metrics: {}, runtimeMs: 12, validation: { valid: true, errorCount: 0, errorList: [] }, published: false,
      details: {
        totalPreferenceCost: 70,
        assumptions: {
          objective: "x", flowSolves: 3, conflictBranches: 1, meritRandomQuotasPreserved: false,
          floorApplied: true, floorSlots: 200, preferencesRemovedByFloor: 2569, cgpaPriority: true,
        },
      },
    };
    render(<AlgorithmCard algorithm="optimized" side={side} />);
    expect(screen.getByText("Held to the baseline").closest("div")).toHaveTextContent("Yes: 200 results protected, 2,569 worse choices ruled out");
    expect(screen.getByText("CGPA used by the optimizer").closest("div")).toHaveTextContent("Yes: higher CGPA gets the better choices among equal results");
    // the quotas row must not claim CGPA is ignored when it is used
    expect(screen.getByText("Merit / lottery quotas").closest("div")).toHaveTextContent("Not preserved (held to the baseline's results instead)");
    expect(screen.queryByText(/CGPA is ignored/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ignores CGPA/)).not.toBeInTheDocument();
  });

  it("only says CGPA is ignored when the optimizer really ignores it", () => {
    const side = {
      metrics: {}, runtimeMs: 1, validation: { valid: true, errorCount: 0, errorList: [] }, published: false,
      details: { assumptions: { objective: "x", flowSolves: 1, conflictBranches: 0, meritRandomQuotasPreserved: false, floorApplied: false, cgpaPriority: false } },
    };
    render(<AlgorithmCard algorithm="optimized" side={side} />);
    expect(screen.getByText("Merit / lottery quotas").closest("div")).toHaveTextContent("Not preserved (CGPA is ignored)");
    expect(screen.getByText("CGPA used by the optimizer").closest("div")).toHaveTextContent("No");
  });
});
