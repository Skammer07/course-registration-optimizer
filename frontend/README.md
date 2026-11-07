# Course Allocation: Frontend

React app for the Course Registration Optimization System. It only **shows and sends** data: every allocation is computed by the backend, and the app never re-implements allocation logic.

React 19 · Vite · Tailwind CSS 4 · React Router · TanStack Query · Recharts · Vitest + Testing Library

## What works today

| Who | Screen | What it does |
|---|---|---|
| everyone | Sign in, change password | Cookie session. A temporary password forces the change before anything else. A session that ends (15 minutes) returns to sign-in with an explanation. |
| admin, faculty | **Allocation runs** | History with filters (semester, status, algorithm), paging, live refresh of running runs. |
| admin | **New run** | Pick the semester from a list of those that have data (the only or last-used one is preselected, and it warns if the semester is missing students, courses or preferences). Compare both algorithms or run one: merit/lottery split, seed, course limit, timetable check, and for the optimizer "Never leave a student worse off than the baseline" (on by default) and "Use CGPA to decide who gets the better choices" (on by default). Shows progress and can cancel a long run. |
| admin, faculty | **Run page** (the comparison dashboard) | Overview (headline numbers, side-by-side chart, full metrics table, how each algorithm behaved), **Students** (a Baseline and an Optimized column for every student with an Improved / Worse / Same verdict, outlined courses where the two differ, and a filter for students whose courses differ), **Courses** (seats filled, demand, who got what), **Details** (settings, inputs, validation). CSV export. |
| admin | Run actions | Publish (choose the algorithm, with the consequences spelled out), verify by replay, delete, cancel. The overview also shows **Compared with the baseline, student by student**: how many results are better, the same or worse, the average rank of the highest-CGPA fifth against everyone else, the worst rank, and the CGPA-priority violations of both algorithms. |
| admin, faculty | **Courses** | Per semester: seats, how many students ranked each course (submitted lists), when it meets, with filters (including **Type**: elective or compulsory), sort, a weekly timetable that highlights overlapping classes, and add / edit. The form has a **Type** selector: a compulsory course takes departments instead of seats and an elective group, is not allocated, and is shown with a Compulsory badge. A warning appears when only some courses have times, because a run with the clash check is refused then. |
| admin, faculty | **Students** | Per semester: who has submitted all, some or none of their preference lists (a badge per elective group), search and filters, add / edit. A student's page shows each ranked list with seats, demand and times. Faculty can change a name or department; marks, groups and active status are admin-only. |
| admin | **Import data** | Upload or paste a CSV of students, courses or preferences. "Check the file" validates without saving and lists every problem row; "Import" unlocks only for a file that passed. New logins' temporary passwords are shown once, with copy and download. |
| student | **My results** | Where the semester stands, the courses they were given and the rank of each in their own list, and **Your compulsory courses** (their department's fixed classes with times, shown even before results are published). |
| student | **My preferences** | One priority list per elective group (OE1, OE2, ...), up to **15 choices each, best first**. Open electives appear in every group's list (one shared pool), so the two lists can even be identical; the page shows "n of 15 chosen", stops at 15, and only enables Submit when the list is full (15, or all courses when fewer exist). Save draft works at any length. Shows **Your compulsory classes** and marks an elective that overlaps one ("Overlaps MA201"): such a course will not be allocated. |

Not built yet: semester and deadline management and user management screens. The backend API for both already exists (see `docs/api-contract.md`). The run page also shows, for the optimizer, when its search stopped early ("may not be the best possible") and how many ranked courses were left out because of compulsory classes.

## Run it

You need Node 20.19+ (or 22) and the backend running on port 5000 (see `backend/README.md`).

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

The dev server forwards `/api` and `/health` to the backend, so the session cookie stays on one origin and no CORS setup is needed. To use a backend elsewhere: `VITE_DEV_API_TARGET=http://host:port npm run dev`.

To get a login, create an admin with `node scripts/create-admin.js --email you@college.edu` in `backend/` (it prints a one-time password; the app makes you change it at first sign-in). Then add students and data through the API, the CSV imports or `npm run seed` in `backend/`.

Production build: `npm run build` writes `dist/`. Serve it from the same origin as the API (reverse proxy) so cookies work; if the API is on another origin set `VITE_API_BASE_URL` at build time and the backend's `CLIENT_ORIGIN` to this site's address.

## Folder map

```
src/
  api/          one small module per area; client.js is the only place that calls fetch
  auth/         session context (AuthProvider) and route guards
  components/
    ui/         the shared building blocks: Button, Card, Badge, Alert, Dialog, Toast, Tabs, tables...
    layout/     app shell (sidebar / mobile drawer), centered auth layout
  features/runs/  the comparison dashboard: overview, chart, students and courses tabs, run actions
  features/data/  course and student forms, weekly timetable grid, CSV import description
  features/semesters/  the semester picker and the shared "which semester" selection
  features/preferences/ ranking helpers for the student's preference lists
  features/student/    the student's compulsory-course list shared by the two student pages
  pages/        one file per screen (admin/, data/, student/, sign-in)
  lib/          formatting, metric rules, error messages, chart colours
  test/         test setup, helpers and fixtures captured from the real API
```

## Design rules (keep them when adding screens)

- **Build from `components/ui`.** New screens compose the existing pieces; add a piece there if one is missing instead of styling one-offs.
- **Colour is meaning.** Blue is always *baseline*, orange is always *optimized*, on every screen. They are the first two slots of a colour-blind-checked palette. Status (good, warning, critical) is never colour alone: it always has an icon and a word. Tokens live in `src/index.css`; the chart colours in `src/lib/chartTheme.js` must match them (a test enforces it).
- **Charts:** one axis, thin bars with rounded ends, a legend, a text alternative and the same numbers in a table, a tooltip that leads with the value. No number on every bar.
- **No verdicts.** The two algorithms follow different policies, so the UI shows differences and which way each one points per metric, never an overall winner.
- **Every screen handles loading, empty, error and success.** Data from a refetch keeps the previous view (dimmed) instead of flashing a skeleton.
- **Plain-language errors** with the reference id (`requestId`) to quote. Map new error codes in `src/lib/errors.js`.
- **Accessibility:** every control has a label, dialogs trap focus and return it, tabs use arrow keys, contrast is at least WCAG AA (text 4.5:1, controls and chart marks 3:1), motion respects *reduce motion*.
- Light theme only for now (a dark theme needs its own validated colour steps).

## Tests

```bash
npm test             # 276 tests, about 15 seconds, no backend needed
```

The tests drive the real screens against **responses captured from the real backend** (`src/test/fixtures`), so they stay faithful to the actual API. After you change an API response the frontend reads, refresh them and re-run:

```bash
cd ../backend && node tests/e2e/captureFrontendFixtures.mjs   # uses a throwaway database, then drops it
cd ../frontend && npm test
```

What the tests cannot show is how the pages *look*: check new screens in a browser, at a phone width and a desktop width.
