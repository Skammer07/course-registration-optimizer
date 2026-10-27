
import { describe, it, expect } from "vitest";
import * as metrics from "../src/evaluation/metrics.js";

describe("Evaluation metrics", () => {
  it("loads the metrics module", () => {
    expect(metrics).toBeDefined();
  });
});
