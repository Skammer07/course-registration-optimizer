import { cn } from "./cn.js";

/** One consistent icon set: 24px grid, 1.75 stroke, inherits the text colour. */
const PATHS = {
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  x: ["M6 6l12 12", "M18 6L6 18"],
  alert: ["M12 3.8l9.2 16H2.8L12 3.8z", "M12 10.2v4.3", "M12 17.3v.01"],
  info: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 11v5", "M12 7.9v.01"],
  history: ["M3.5 12a8.5 8.5 0 1 0 2.7-6.2", "M3.5 4.5v4h4", "M12 8v4.2l2.8 1.8"],
  play: ["M7.5 5.2l11 6.8-11 6.8V5.2z"],
  list: ["M9 6h11", "M9 12h11", "M9 18h11", "M4.5 6h.01", "M4.5 12h.01", "M4.5 18h.01"],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4.5 20.5a7.5 7.5 0 0 1 15 0"],
  logout: ["M9 4.5H5.5A1.5 1.5 0 0 0 4 6v12a1.5 1.5 0 0 0 1.5 1.5H9", "M15 8l4 4-4 4", "M19 12H9"],
  download: ["M12 4v11", "M7.5 11l4.5 4.5 4.5-4.5", "M5 19.5h14"],
  upload: ["M12 15V4", "M7.5 8l4.5-4.5L16.5 8", "M5 19.5h14"],
  plus: ["M12 5v14", "M5 12h14"],
  edit: ["M4.5 19.5l1-4L16 5a2 2 0 0 1 3 3L8.5 18.5l-4 1z", "M14 7l3 3"],
  grid: ["M4.5 5h15v14h-15z", "M4.5 10h15", "M10 5v14"],
  search: ["M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z", "M16 16l4.5 4.5"],
  chevronDown: ["M6 9l6 6 6-6"],
  chevronRight: ["M9 6l6 6-6 6"],
  chevronLeft: ["M15 6l-6 6 6 6"],
  arrowUp: ["M12 19V5", "M6 11l6-6 6 6"],
  arrowDown: ["M12 5v14", "M6 13l6 6 6-6"],
  trash: ["M4.5 7h15", "M9.5 7V4.5h5V7", "M6.5 7l.8 12.5h9.4L17.5 7", "M10 11v5", "M14 11v5"],
  ban: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M5.7 5.7l12.6 12.6"],
  shield: ["M12 3.5l7 2.8v5.4c0 4.2-2.9 7.4-7 8.8-4.1-1.4-7-4.6-7-8.8V6.3l7-2.8z", "M8.8 12l2.4 2.4 4-4.4"],
  menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
  refresh: ["M20 11a8 8 0 0 0-14.4-4.2", "M4 5v4.2h4.2", "M4 13a8 8 0 0 0 14.4 4.2", "M20 19v-4.2h-4.2"],
  copy: ["M9 9h10.5v10.5H9z", "M15 9V5.5H4.5V15H9"],
  book: ["M5 4.5h10.5a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3V4.5z", "M5 17a3 3 0 0 1 3-3h10.5"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7.5V12l3 2"],
  dot: ["M12 12h.01"],
};

export function Icon({ name, className = "size-4", strokeWidth = 1.75 }) {
  const paths = PATHS[name];
  if (!paths) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** The product mark: a check in a rounded square. */
export function Logo({ className = "size-8" }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("shrink-0", className)} aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="var(--color-accent)" />
      <path d="M9 16.5l4.5 4.5L23 11.5" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
