import "@testing-library/jest-dom/vitest";
import { cloneElement } from "react";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Screens load data asynchronously; the default 1 s wait is too tight on a busy machine or a
// shared CI runner, so tests failed at random. A passing test is never slower for a longer limit.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => cleanup());

// jsdom has no layout engine: give charts a fixed size instead of measuring.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ResponsiveContainer: ({ children }) => cloneElement(children, { width: 640, height: 360 }),
  };
});

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
