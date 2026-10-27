
import { describe, it, expect } from "vitest";
import {
  MinCostMaxFlow,
  minCostMaxFlow,
} from "../src/algorithms/minCostMaxFlow.js";

describe("Min-cost max-flow", () => {
  it("exports the expected functions", () => {
    expect(typeof MinCostMaxFlow).toBe("function");
    expect(typeof minCostMaxFlow).toBe("function");
  });

  it("finds the maximum flow with minimum cost", () => {
    const result = minCostMaxFlow(
      4,
      [
        { from: 0, to: 1, capacity: 1, cost: 1 },
        { from: 0, to: 2, capacity: 1, cost: 0 },
        { from: 1, to: 3, capacity: 1, cost: 0 },
        { from: 2, to: 3, capacity: 1, cost: 5 },
      ],
      0,
      3
    );

    expect(result.flow).toBe(2);
    expect(result.cost).toBe(6);
  });

  it("respects the maximum flow limit", () => {
    const result = minCostMaxFlow(
      2,
      [{ from: 0, to: 1, capacity: 5, cost: 3 }],
      0,
      1,
      2
    );

    expect(result.flow).toBe(2);
    expect(result.cost).toBe(6);
  });

  it("returns zero flow when no path exists", () => {
    const result = minCostMaxFlow(
      3,
      [{ from: 0, to: 1, capacity: 1, cost: 2 }],
      0,
      2
    );

    expect(result.flow).toBe(0);
    expect(result.cost).toBe(0);
  });

  it("rejects negative capacity", () => {
    const network = new MinCostMaxFlow(2);

    expect(() => network.addEdge(0, 1, -1, 0)).toThrow(
      "capacity must be a non-negative integer"
    );
  });
});
