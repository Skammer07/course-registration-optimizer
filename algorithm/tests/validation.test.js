
import { describe, it, expect } from "vitest";
import * as validation from "../src/validation/validateAllocation.js";

describe("Allocation validation", () => {
  it("loads the allocation validation module", () => {
    expect(validation).toBeDefined();
  });
});
