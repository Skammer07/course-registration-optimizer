# Course Registration Optimization System: Project Status Report

Date: 3 November 2026. Algorithm version: 1.5.1.

This report answers three questions:
1. How is the project implemented today?
2. How does it differ from the "Current Algorithm Design and Working" overview?
3. What remains, and is it feasible?

It is based on reading the source code, running the three automated test suites, and running the algorithms on a generated 200-student dataset. The application pages were not opened in a browser, and timings are single runs on one machine. The real-database end-to-end script (`backend/tests/e2e/realdb.e2e.mjs`) passed 147 of 147 checks on 1 November 2026, before the 500-student data was loaded. The earlier version of this report (31 October, algorithm 1.1.0) listed compulsory courses, elective groups and the optimizer speed-up as missing; all three are now implemented. The algorithm-only analysis is in `docs/implementation-status-report.md`.

---

## 1. Summary

The project is a working system with three layers: an allocation engine, a backend API and a web frontend. Both algorithms run end to end, results are validated, runs are stored, compared, replayed and published, and the frontend drives all of it for administrators, faculty and students.

| Part | Test files | Tests | Result |
|---|---:|---:|---|
| Algorithm | 20 | 162 | All pass |
| Backend | 36 | 693 | All pass |
| Frontend | 17 | 274 | All pass (a few can time out on a heavily loaded machine; they pass when re-run) |

**Implemented since the overview was written:**
1. Elective groups (OE1, OE2, ...): each group is an independent priority list of up to **15 choices**, best first; a submitted list must be full. Open electives (a course with no group) are offered in every group, so both lists draw from **one shared pool** (they may even be identical). A student gets at most one course per group and never the same course twice (both algorithms, validator, metrics, backend, student page).
2. Compulsory courses: modelled as fixed timetable slots per student; no elective that overlaps one is allocated. Students can see their own compulsory classes.
3. Optimizer speed-up and a search limit (an answer that may not be provably optimal is flagged).
4. The baseline default is 70/30, as in the IIT (ISM) UG manual, with no seat lost to rounding. With groups the merit phase serves students strictly in CGPA order across the whole pool.
5. **The optimizer is held to the baseline's result and uses CGPA.** No student ends worse than under the baseline in any group (high-CGPA students keep exactly their baseline result), the optimizer's total is never worse, and among equal results higher CGPA gets the better choices. The CGPA is the cumulative CGPA up to the previous semester, as at pre-registration. The run page shows the better / same / worse comparison and the CGPA-priority violations of both algorithms.
6. A deterministic search limit (work counted in edges the flow solver looks at) so an optimizer run that stops early stops at the same point every time.

**Still open:** strict CGPA order everywhere (the baseline's lottery and the floor keep some lower-CGPA winners), a second allocation round, the 10-student minimum, department eligibility for electives, half-semester courses, semester and user management screens, faster re-solving so the optimizer proves optimality on larger inputs, and a repeatable benchmark with a results write-up. The official college rules are still unconfirmed (`docs/allocation-rules.md` is now pre-filled from the UG manual, with the unconfirmed points marked).

---

## 2. How the project is implemented today

### 2.1 Structure

| Layer | Folder | Role |
|---|---|---|
| Algorithm | `algorithm/` | Pure JavaScript engine. Takes plain data, returns allocations, metrics and validation. |
| Backend | `backend/` | Express + MongoDB API. Stores data, prepares input, runs algorithms in a worker thread, stores, replays and publishes runs. |
| Frontend | `frontend/` | React app (Vite, Tailwind). Shows and sends data; never re-implements allocation. |
| Documents | `docs/`, `data/` | Design notes, API contract, rules, status reports, sample data. |

### 2.2 Algorithm layer

- **Baseline:** students sorted by CGPA. Per course, the merit quota is the rounded 70% of the seats and the lottery gets the rest (default 70/30). With elective groups the merit phase serves **students in CGPA order, each taking the best available course of every group's own list** (never a course already held); the lottery draws per group and gives each student their best-ranked course with a free lottery seat. Without groups it keeps the original two merit iterations and per-course lottery. The seed is stored so runs reproduce.
- **Optimizer:** a flow network (Source → Student → [Student, Group] → Course → Sink). The group node with capacity 1 makes "one course per group" exact, and an extra node stops a student receiving the same course through two groups. Cost is the course's rank in that group's list minus 1; it maximizes assignments, then minimizes preference cost. Timetable clashes are resolved by a best-first branching search with cost pruning, on a network built once and reused. A search limit (the backend uses 2.5 billion edges of work, about 12 s, plus 2000 solves and 30 s as safety nets) returns the best clash-free answer found, flagged `optimal: false` with a bound.
- **Held to the baseline, with CGPA (default):** the optimizer is given the baseline's own allocation. For every (student, group) the baseline filled, only courses ranked at least as high are allowed, and the slot must stay filled; the baseline's result is the optimizer's first answer, so it is never worse. Edge costs carry a CGPA weight that only decides between results of equal preference cost. Both can be switched off per run (`optimizerFloor`, `cgpaPriority`). The metric `cgpaPriorityViolations` counts justified envy. Since 1.5.1 the greedy first answer never gives up a baseline course, so large inputs (500 students) improve on the baseline.
- **Compulsory slots:** a per-student `fixedTimetable`. The optimizer removes overlapping electives before building the network (exact); the baseline checks them in both phases; the validator and metrics treat an overlap as a clash.
- **Validator:** one shared definition checks capacity, per-student limit, duplicates, "was this course ranked", unknown ids, timetable clashes (including compulsory slots) and at most one course per group. The backend uses it again before publishing.
- **Metrics and comparison:** assignments, students with one or two courses, unallocated, utilization, rank-1 and rank-2 counts, average rank, violation counts, plus `studentsMissingAGroup` and `groupLimitViolations`. The comparison reports differences and declares no winner.
- **Entry points:** `runSingleAllocation`, `runAllocationComparison`, central exports, `ALGORITHM_VERSION` (1.5.1).

### 2.3 Backend layer

- **Roles and login:** admin, faculty and student, cookie sessions, forced password change, user management endpoints.
- **Data:** students; courses with `kind` (elective or compulsory), `departments`, elective group and timetable slots; preferences per elective group (at most 15 courses; a submitted list must be full: 15, or every available course when fewer exist); semesters with preference windows and deadlines.
- **Import:** CSV import for students, courses (including `kind` and `departments`) and preferences, with a check-only mode.
- **Runs:** compare, run a single algorithm, list and filter, cancel, delete, replay-verify, CSV export. Each stored run keeps the input snapshot (including each student's compulsory slots), a fingerprint, the seed, the configuration (including `oneCoursePerGroup`) and the algorithm version. Algorithms run in a worker thread with a time limit and a memory cap.
- **Publishing:** the stored result is re-validated against the snapshot; one algorithm per run can be published.
- **Student endpoints:** submit preferences, view published results, view own compulsory courses (`GET /courses/my-compulsory`).
- **Contract:** about 52 routes in `docs/api-contract.md`, and a Postman collection.

### 2.4 Frontend layer

| User | Screens that exist |
|---|---|
| Everyone | Sign in, change password, session-expiry handling |
| Admin / faculty | Run history; run comparison dashboard (overview with the better / same / worse evidence panel, charts, students, courses, details, including a note when the optimizer's search stopped early); course and student lists with add/edit (course type and departments); weekly timetable grid; CSV import |
| Admin | New run (compare or single, 70/30 split, seed, limit, timetable on/off, hold the optimizer to the baseline, use CGPA, cancel); run actions (publish, verify, delete) |
| Student | My preferences (one list per group, up to 15 choices each, "n of 15 chosen", compulsory classes and overlap warnings); My results (allocated electives with their group, and compulsory courses) |

---

## 3. How it differs from the overview you sent

### 3.1 Matches

Inputs, the baseline's CGPA ordering and shared merit quota, the seeded lottery, the optimizer network and two-level objective, the timetable conflict search, the validator checks, the metrics, the three ways to run, and the central exports all match the overview.

### 3.2 Where the code now differs from what the overview describes

| Overview says | Code now |
|---|---|
| 75/25 default | **70/30** (IIT (ISM) UG manual). The merit share is rounded and the lottery gets the rest, so no seat is lost (the overview's floor rule lost seats). |
| Two merit iterations, one global limit of two courses | With elective groups: **students in CGPA order, each taking the best course of every group's list**. Without groups: two iterations as before. |
| Random phase: randomize students and use their remaining preferences | With groups: per group, students in a random order each take their **best-ranked** course with a lottery seat. Without groups: the original per-course shuffle. |
| Optimizer enforces only a global limit | At most **one course per elective group** (each group an independent list drawing from one shared pool), never the same course twice; exact in the flow. |
| Preference lists are free length | At most **15 choices** per group; a submitted list must be full. |
| Compulsory courses not modelled | Fixed per-student slots (matched by department); never allocated. |
| Optimizer ignores CGPA | Held to the baseline's result (no student ends worse) with CGPA deciding between equal results; measured by `cgpaPriorityViolations` and a per-student comparison. |
| Optimizer can take 39 s to over 80 s on 200 students | Faster (cost pruning, best-first) and bounded by a search limit; with groups, 4.2 s and proved optimal on the 200-student test data. |
| "Tests for groups, compulsory clashes, large datasets: none" | Added (including an exhaustive exactness check against brute force). |

### 3.3 Still as the overview says

Strict CGPA order is not enforced everywhere (the optimizer is held to the baseline's result and uses CGPA only between equal results, and the baseline's lottery lets lower-CGPA students win some seats); eligibility, prerequisites, reserved seats and multiple rounds are not modelled; the baseline is not confirmed against an official procedure beyond what the UG manual states.

---

## 4. Result on the 200-student test data

Generated data (semester `SEM-2026`: 200 students, 20 electives in two groups, 8 compulsory courses overlapping 36% of ranked electives). Single runs.

| | Baseline (70/30) | Optimized |
|---|---:|---:|
| Students with two courses from the same group | 0 | 0 |
| Students with a course in both groups | 163 | 181 |
| Students missing a group | 37 | 19 |
| Assignments | 363 | 381 |
| Average preference rank | 2.20 | 2.06 |
| Time | 0.06 s | 4.2 s (search finished, proved optimal) |

This run is from before the CGPA work (the optimizer ignored CGPA), so it is not like-for-like with the baseline. The like-for-like results are in the next sections.

---

### Held to the baseline, with CGPA (100 students, 20 courses)

| | Baseline | Optimizer without the floor | **Optimizer now** |
|---|---:|---:|---:|
| Average rank | 2.15 | 1.20 | **1.25** |
| Students worse than the baseline | – | 18 | **0** |
| Top-20% CGPA average rank | 1.05 | 1.20 | **1.05** |
| Everyone else, average rank | 2.43 | 1.20 | **1.30** |
| Worst rank anyone was given | 15 | 3 | **3** |
| CGPA-priority violations | 157 | 33 | 43 |

At 200 students and 25 courses: 1.26 average rank with 0 worse (baseline 1.88); proven optimal in 1.3 s. The remaining CGPA-priority violations are mostly lottery winners the floor protects.

### Held to the baseline at 500 students (40 courses)

| 500 students, 40 courses (1,213 seats for 1,000 slots) | Average rank | Worse than baseline | Top-20% CGPA avg | Rest avg | CGPA-priority violations | Proven optimal | Time |
|---|---:|---:|---:|---:|---:|---|---:|
| Baseline | 1.99 | – | 1.05 | 2.22 | 848 | – | 0.05 s |
| Optimizer without the floor | 1.27 | 114 | 1.30 | 1.26 | 222 | No | 8 s |
| **Optimizer held to the baseline, with CGPA** | **1.41** | **0** | **1.05** | **1.50** | **338** | No | 8 to 16 s |

At 500 students the search stops at its work limit, so the result is valid and never worse than the baseline for any student, but not proven optimal (127 students better, 873 the same). Version 1.5.0 returned exactly the baseline here (average 1.99): its greedy first answer gave up a student's baseline course when two courses clashed, lost the slot, and was discarded, so nothing better than the floor was ever found. Version 1.5.1 never gives up a baseline course in that first step; 100 and 200 students are unchanged and still proven optimal.

The development database currently holds this 500-student dataset (Student0001 to Student0500, Course1 to Course40, 15-choice OE1 and OE2 lists).

### Open electives (one shared pool, 200 students)

One pool of 25 open electives, two independent 15-choice lists per student (OE1, OE2), generator scenario `open-electives`. Single runs.

| | Baseline (70/30) | Optimized |
|---|---:|---:|
| Slots filled | 400 of 400 | 400 of 400 |
| Average preference rank | 1.88 | 1.17 |
| Total preference cost | 352 | 68 |
| Same course twice / two in one group | 0 / 0 | 0 / 0 |
| Time | 0.07 s | about 12 s (stopped at its work limit; lower bound 62, so within about 10% of the best possible) |

## 5. What remains, and is it feasible?

All items are technically possible with the current design. Effort is for one developer including tests.

| # | Remaining item | Feasible? | Effort | Needs the college? |
|---|---|---|---|---|
| 1 | ~~CGPA in the optimizer~~ | **Done** (1.5.0, improved in 1.5.1): held to the baseline's result plus a CGPA tie-break. Strict CGPA order everywhere stays open (needs a policy on lottery seats). | | |
| 2 | ~~Per-student "better / same / worse than baseline" evidence~~ | **Done** (run page panel) | | |
| 3 | Second allocation round (vacant seats), random fill for short lists, 10-student minimum | Yes | 2 to 3 days | Yes |
| 4 | Department eligibility for electives, similar-content exclusions | Yes | 1 to 2 days | Yes |
| 5 | ~~15-preference limit~~ | **Done** (at most 15; a submitted list must be full) | | |
| 6 | Half-semester (modular) courses | Yes | 1 to 2 days | Yes |
| 7 | Compulsory matching by section and study semester | Yes | 1 to 2 days | Yes |
| 8 | Admin screens for semesters/deadlines and user management (backend exists) | Yes | 2 to 4 days | No |
| 9 | Compulsory courses in admin views (by-student view, CSV export) and clearer wording on the Courses page | Yes | 1 day | No |
| 10 | Optimizer: re-solve a branch from its parent's flow (about 45 ms per solve at 200 students now), identical-slot clash groups in the flow | Yes | 2 to 4 days | No |
| 11 | Repeatable benchmark and results write-up for the project report | Yes | 2 to 3 days | No |
| 12 | Check the new pages in a browser (the real-database script passed 147/147 on 1 November; re-run it against the 500-student data) | Yes | under 1 day | No |

**Risks**
- The optimizer's result is not always provably optimal when the search limit is hit; the output says so, and the report should too.
- Every behaviour change must bump `ALGORITHM_VERSION`; runs stored before 1.3.0 replay without the group rule.
- The test data is generated; all results are indicative, not institutional.
- The student accounts created for testing share one password in the cloud database; they are mock accounts only.

---

## 6. Recommended order

1. Confirm the open rules with the Academic Section (`docs/allocation-rules.md`, section 7), including whether lottery seats may be overridden by CGPA.
2. ~~CGPA handling and per-student comparison evidence~~ (done).
3. Admin screens for semesters and users, compulsory courses in the admin views (the 15-preference limit is done).
4. Second round, minimum size, eligibility (once confirmed).
5. Benchmark and results write-up.

## 7. Questions that need answers

1. How are equal CGPAs resolved? (The CGPA itself is settled: the cumulative CGPA up to the previous semester, as at pre-registration.)
2. Must every student get a course for every elective slot, or is "at most one" enough?
3. How are a student's compulsory courses and their timetable supplied (department, semester, section)?
4. Is the optimizer meant to reproduce the official procedure, or to be a benchmark that never does worse than it?
5. Does the second round follow the same CGPA/random rule, and what happens to courses with fewer than 10 students?
6. Are there prerequisites or reserved seats?
