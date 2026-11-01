/**
 * tests/unit/courseUpdateKind.test.js
 * updateCourse checks the kind/department rules against the course as it would
 * be after the change (an update query cannot compare fields with each other).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindById = vi.fn();
const mockFindByIdAndUpdate = vi.fn();

vi.mock("../../src/models/Course.js", () => ({
  default: {
    findById: (...args) => ({ lean: () => mockFindById(...args) }),
    findByIdAndUpdate: (...args) => ({ lean: () => mockFindByIdAndUpdate(...args) }),
  },
}));

const { updateCourse } = await import("../../src/services/course.service.js");

const elective = { _id: "1", courseCode: "E1", kind: "elective", electiveGroup: "A", capacity: 10, departments: [] };
const compulsory = { _id: "2", courseCode: "M1", kind: "compulsory", electiveGroup: null, capacity: 0, departments: ["CSE"] };

describe("updateCourse kind rules", () => {
  beforeEach(() => {
    mockFindById.mockReset();
    mockFindByIdAndUpdate.mockReset().mockImplementation(async (id, update) => ({ ...update.$set }));
  });

  it("rejects turning an elective into a compulsory course without departments", async () => {
    mockFindById.mockResolvedValue(elective);
    await expect(updateCourse("1", { kind: "compulsory", electiveGroup: null }))
      .rejects.toThrow(/at least one department/);
    expect(mockFindByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("rejects turning an elective into a compulsory course that keeps its group", async () => {
    mockFindById.mockResolvedValue(elective);
    await expect(updateCourse("1", { kind: "compulsory", departments: ["CSE"] }))
      .rejects.toThrow(/elective group/);
  });

  it("accepts turning an elective into a compulsory course when the rules hold", async () => {
    mockFindById.mockResolvedValue(elective);
    await updateCourse("1", { kind: "compulsory", departments: ["CSE"], electiveGroup: null });
    expect(mockFindByIdAndUpdate).toHaveBeenCalled();
  });

  it("rejects emptying the departments of a compulsory course", async () => {
    mockFindById.mockResolvedValue(compulsory);
    await expect(updateCourse("2", { departments: [] })).rejects.toThrow(/at least one department/);
  });

  it("rejects putting a compulsory course into an elective group", async () => {
    mockFindById.mockResolvedValue(compulsory);
    await expect(updateCourse("2", { electiveGroup: "A" })).rejects.toThrow(/elective group/);
  });

  it("leaves ordinary elective edits unaffected", async () => {
    mockFindById.mockResolvedValue(elective);
    await updateCourse("1", { title: "New title", capacity: 12 });
    expect(mockFindByIdAndUpdate).toHaveBeenCalled();
  });

  it("returns not found for an unknown course", async () => {
    mockFindById.mockResolvedValue(null);
    await expect(updateCourse("9", { title: "x" })).rejects.toThrow(/not found/i);
  });
});
