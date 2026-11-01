# Implementation Status Report: Algorithm Design vs. Actual Code

Audit date: 2026-10-31. Algorithm version audited: `1.1.0`. **Updated 2026-11-01 for version `1.5.1`** (see the status table below; sections 2 and 3 describe the code as audited, and each item in sections 3 and 4 is marked with what has since changed).
Scope: the `algorithm/` package, its wiring in `backend/`, and the project's design write-up (the "Current Algorithm Design and Working" document, called "the design document" below).

**How this was checked.** Every claim was compared against the source files. The test suites were run during the audit: `algorithm/` has 14 files and 95 tests, all passing, and `backend/` has 31 files and 607 tests, all passing. Nothing was benchmarked in this audit. Performance figures quoted below come from the existing `docs/algorithm-design.md`, not from new measurements.

Legend: ✅ implemented and matches the design document, ⚠️ implemented but differs from the document or has a gap, ❌ not implemented.

## 0. Status on 2026-11-01 (algorithm 1.3.0)

| Item from this audit | Now |
|---|---|
| Optimizer performance (pruning, best-first) | ✅ done, plus a search limit with an `optimal` flag |
| Compulsory-course timetable constraints | ✅ done (fixed per-student slots, department matching) |
| Elective groups (one course per group) | ✅ done in both algorithms, the validator and the metrics |
| Baseline fairness fixes | ✅ partly: 70/30 default, no seat lost to rounding, merit one round per group, lottery gives each student their best-ranked free course; not done: unused merit seats are still not reused, the tie rule is unchanged |
| CGPA-aware optimizer | ✅ see the next row |
| Tests for compulsory clashes, groups, large datasets | ✅ added (133 algorithm tests, including exhaustive exactness checks); CGPA tests wait for the CGPA design |
| Elective groups as independent priority lists (up to 15 choices) drawing from one shared pool; the same course never twice | ✅ done in 1.4.0 (baseline serves students in CGPA order across the pool) |
| CGPA-aware optimizer | ✅ done in 1.5.0 (improved for large inputs in 1.5.1) as "held to the baseline's result" (no student ends worse) plus a CGPA tie-break; strict CGPA order everywhere is not promised |
| `ALGORITHM_VERSION` | 1.5.1 (1.5.1: the greedy first answer no longer gives up a baseline course, so a 500-student run improves on the baseline instead of returning it) |

---

## 1. Summary

| Area | Status |
|---|---|
| Inputs (students, courses, preferences, timetable) | ✅ |
| Baseline: merit (2 iterations) + seeded random | ✅ with ⚠️ differences (section 3.1); several since fixed |
| Optimized: MCMF + timetable conflict search | ✅ |
| Validation module and metrics | ✅ |
| Single / comparison services, central exports, version tag | ✅ |
| Backend APIs (baseline-only, optimized-only, compare) | ✅ |
| CGPA-aware optimizer | ❌ |
| Compulsory-course timetable constraints | ❌ at audit; ✅ now |
| Elective-group constraints (one course per group) | ❌ at audit; ✅ now |
| Optimizer performance work (pruning) | ❌ at audit; ✅ now |
| Tests for CGPA priority, compulsory clashes, groups, large datasets | ❌ at audit; added except CGPA |

**Verdict.** The "what is implemented" half of the design document is accurate, with the few differences listed in section 3.1. All four planned improvements are still open. All four are technically feasible (section 5). Two of them, CGPA priority and the elective-group rule, are blocked less by engineering than by missing college policy: `docs/allocation-rules.md` is still an unfilled template.

---

## 2. What is implemented (verified against code)

### 2.1 Inputs
- Students, courses, preferences with rank, and an optional timetable `{courseId: [{day,start,end}]}` are all consumed. Validation of shapes, duplicates and unknown ids is in each algorithm.
- Timetable parsing: `HH:MM`, same-day comparison (case-insensitive), adjacent classes do not clash (`algorithm/src/timetable/checkClash.js`).

### 2.2 Baseline (`baseline.js`, `randomAllocation.js`, `allocationPipeline.js`)
- ✅ Merit/random ratios, default 75/25, configurable. Quota is `floor(capacity × ratio)`.
- ✅ Students sorted by CGPA descending, student id as the deterministic tie-break.
- ✅ Two merit iterations, one course per student per iteration, shared merit quota across both iterations, preferences tried in rank order, timetable check through the `canEnroll` hook.
- ✅ Tie handling: when the last merit seat of a course is taken, equal-CGPA students who ranked it are admitted, never above real capacity.
- ✅ Random phase: separate random quota, unused merit seats are not transferred, student limit and timetable respected, capacity never exceeded.
- ✅ Seeded randomness: mulberry32 (`utils/seededRandom.js`). The seed is generated if absent and returned in `configuration.randomSeed`. Same input and seed give the same result.
- ✅ The combined result is validated and the run throws on any violation.

### 2.3 Optimized (`optimizedAllocation.js`, `minCostMaxFlow.js`)
- ✅ Network is Source → Student (cap `maxCoursesPerStudent`, cost 0) → Course (cap 1, cost `rank-1`) → Sink (cap = capacity, cost 0).
- ✅ Objective: maximize assignments, then minimize rank cost, then a deterministic tie-break. Solver is successive shortest paths with Bellman-Ford.
- ✅ Timetable clashes: solve, find a clashing pair, branch on forbidding either edge, keep the best clash-free solution. Revisited states are skipped, and branches with a lower flow than the best are dropped.
- ✅ Output states `meritRandomQuotasPreserved: false`, so the CGPA limitation is declared in the output.

### 2.4 Validation and metrics
- ✅ `validateAllocation` checks: unknown student/course, duplicate pairs, assignment not in the student's preferences, course capacity, student limit, timetable clash. This is the single shared definition, used by both services and by the backend before publishing (`publicationValidation.service.js`).
- ✅ `calculateMetrics` returns: total assignments, students with at least one / two courses, unallocated, total capacity, utilization, rank-1 and rank-2 counts, average rank, and the capacity / student-limit / duplicate / invalid / timetable violation counts and their total.
- ✅ Comparison (`compareAllocations`) reports optimized-minus-baseline per metric plus runtimes, and declares no winner.

### 2.5 Services, exports, versioning
- ✅ `runSingleAllocation(input, {algorithm})`, `runAllocationComparison`, and a central `src/index.js`. `ALGORITHM_VERSION = "1.1.0"` is stored with each run.

### 2.6 Backend
- ✅ `POST /allocations/compare` and `POST /allocations/run` (baseline or optimized) are both admin-only. Stored runs keep an input snapshot, fingerprint, seed and version, with replay verification and publish. Algorithms run in a worker thread with a time limit and a memory cap.
- ✅ Courses carry `electiveGroup` and `timetableSlots`; students carry `department` and `electiveGroups`. Preferences are submitted per elective group and checked against the student's allowed groups and the course's group.
- ✅ A partial timetable (some courses with slots, some without) is rejected before a run starts.

---

## 3. Where the code differs from the design document

### 3.1 Baseline differences (the document describes something slightly different)

Since the audit: row 1 is changed for elective groups (the lottery now draws per group and gives each student the best-ranked course with a free seat), row 2 is changed (one merit round per group), and row 3's seat loss is fixed (merit seats are rounded and the lottery gets the rest; the default is now 70/30). Row 4 and the rule that unused merit seats are not reused are unchanged.

| # | Design document says | Code does | Impact |
|---|---|---|---|
| 1 | Random phase: "randomize the processing order of eligible students, consider their remaining preferences" | It shuffles the list of students who ranked each course, per course, and processes courses in list order. It ignores preference rank and does not prioritise students with fewer courses. | Earlier courses get first pick of students. A student can win a rank-5 seat while a rank-1 seat was available. The document should be corrected, or the phase changed (section 5.5). |
| 2 | "Two merit iterations", max two courses per student | Hard-coded to 2 iterations (`baseline.js:209`) | If `maxCoursesPerStudent` is 3 or more, the merit phase still stops at 2 per student. Not visible today because the default is 2. |
| 3 | Quota is floor of capacity × ratio, "total capacity is never exceeded" | True, but seats are lost to rounding (capacity 3 gives 2 + 0) and unused merit seats are never reused | Seats can stay empty while students go unallocated. The document states the rollover rule, but not the rounding loss. |
| 4 | Merit tie handling | Tied students receive the course even if it is not their best remaining option | Differs from the normal merit path. Policy is unconfirmed. |

### 3.2 Smaller documentation points
- `studentsWithTwoCourses` is a fixed "2" metric; it does not follow `maxCoursesPerStudent`.
- The optimizer ignores `seed`. This is intended but should be stated in the API docs.
- The document says "95 tests passing across 14 test files". That is correct for `algorithm/` (backend adds 607 more).
- `ALGORITHM_VERSION` must be bumped whenever any of the items in section 4 changes output.

---

## 4. Remaining work, with feasibility

### 4.1 CGPA-aware lexicographic optimizer: ❌ still not implemented. Feasible.

*Update 2026-11-01:* the IIT (ISM) UG manual gives the college's rule (70% of an oversubscribed course's seats by CGPA, 30% random), so the optimizer should respect that split rather than rank by CGPA alone. Options are listed in `docs/algorithm-design.md` section 9.

**Current state.** `allocateOptimized` never reads `cgpa` beyond validating that it is a number.

**Target.** Hard constraints, then maximize assignments, then favour higher CGPA, then minimize preference cost.

**Approach.**
1. Keep the first stage as is: find the maximum assignment count `F`.
2. Add a second objective. Edge cost becomes `cgpaPenalty(student) × W + (rank − 1)`, where `W` is larger than the largest total rank cost so CGPA outranks preference. `cgpaPenalty` is the student's position in the CGPA order (0 for the highest).
3. This stays a normal min-cost flow, so the clash-branching search works unchanged, because it only compares `(flow, cost)`.

**Risks and decisions required (cannot be settled by engineering alone).**
- *What does "prioritise" mean?* A strictly lexicographic rule (the top student's outcome can never be traded for any number of lower students) needs exponentially large weights and is numerically unsafe for hundreds of students. Practical options are CGPA bands, linear weights, or running the stages one after another. Each gives different outcomes.
- *Does CGPA outrank the second course?* It should be decided whether a high-CGPA student's second course beats a low-CGPA student's first. The convex-cost idea (second course costs more) from the earlier review addresses this.
- Equal CGPAs and float comparison need a tie rule (round to 2 decimals).

**Effort.** About 1 to 2 days including tests. **Blocked on:** the exact policy (`docs/allocation-rules.md` section 2 is empty).

### 4.2 Compulsory department courses as fixed commitments: ✅ DONE (2026-11-01).

Implemented as designed below: `fixedTimetable` input, the optimizer removes overlapping electives before building the network, the baseline and validator check them, and the run snapshot and fingerprint include them. Courses have a `kind` (elective or compulsory) and `departments`; a student's slots come from the compulsory courses whose departments include theirs. Not done: matching by section or study semester. The text below is the original plan.

**Current state.**
- The Course model comments that `electiveGroup: null` means compulsory, and students have a `department`, but there is no link from a student to compulsory courses and no input field for fixed schedules.
- The algorithm only compares elective-to-elective slots. `publicationValidation.service.js` states that compulsory courses are not enforced.

**Approach.**
1. *Data:* define where a student's compulsory timetable comes from (by department, semester and possibly section). Needs a model or a field.
2. *Input contract:* add `fixedTimetable: { studentId: [slots] }`, or `compulsoryTimetableByDepartment`, to the algorithm input.
3. *Optimizer:* **pre-filter** edges. Before building the network, drop any student-to-course edge whose slots overlap that student's fixed slots. This is exact, it never needs branching, and it makes the problem smaller.
4. *Baseline:* extend `canEnroll` (the existing hook) to include the fixed slots.
5. *Validator and metrics:* add the same check so both algorithms and the pre-publish validation use one definition.
6. Backend: normalize the new data in `allocationEngine.service.js`, store it in the run snapshot, and include it in the fingerprint so replay verification still works.

**Risks.** Slot data quality (missing compulsory timetables must be handled like the existing partial-timetable rejection). Pre-filtering silently removes preferences, so the run output should report how many were removed per student.

**Effort.** About 1 to 2 days. **Blocked on:** the college supplying compulsory timetables and saying how they map to students.

### 4.3 Elective-group enforcement (one course per group): ✅ DONE (2026-11-01).

Implemented as designed below: a node per (student, group) with capacity 1 in the optimizer, a per-group check in the baseline (one merit round per group) and the lottery, the validator, and two new metrics. It applies to courses that have a group and can be switched off with `oneCoursePerGroup: false`. The text below is the original plan.

**Current state.** Group identity is carried through the backend and checked for preference consistency, but both algorithms only enforce a global `maxCoursesPerStudent`.

**Approach.**
- *Optimizer (exact, no branching):* insert a node per (student, group) with capacity equal to the allowed number per group (normally 1): `Source → Student → (Student, Group) → Course → Sink`.
- *Baseline:* add a per-student, per-group counter to `canReceive` and the random phase's checks.
- *Validator and metrics:* reject two courses in one group for a student, and report per-group coverage.
- Question to settle: is "one per group" a maximum only, or must every student receive one from each group? The flow handles "at most one"; "must" becomes a priority in the objective, or a reported shortfall.

**Risks.** Interaction with `maxCoursesPerStudent` (it should equal the number of groups, or be derived from it). Students whose `electiveGroups` list is empty are currently allowed in every group, which is unresolved in the code.

**Effort.** About 1 to 2 days. **Blocked on:** college confirmation of the rule.

### 4.4 Optimizer performance: ✅ DONE (2026-11-01).

Implemented: cost-based pruning, best-first search, cached clashes, direct node lookups, a bounded search that returns the best clash-free answer with `optimal: false` and a bound, and an exhaustive exactness test. Not done: encoding identical-slot clash groups in the flow, and re-solving a branch from its parent. A Dijkstra solver was tried and rejected (not faster, different equal-cost results). The text below is the original plan.

**Current state.** The only pruning is `flow < best.flow`. The documented measurements are 39 s (balanced, 200 students) and over 80 s (many ties). The backend protects itself with a 60 s worker time limit.

**Approach, in order of value** (details in the earlier algorithm review):
1. Also prune on cost (`flow == best.flow` and `cost > best.cost`). The docs report 39 s down to 14 s and 80 s+ down to 7 s with identical results on the datasets tried.
2. Get a clash-free incumbent early and explore best-first.
3. Encode identical-slot clash cliques inside the network (one node per student and clique), which removes much of the branching exactly.
4. Dijkstra with potentials instead of Bellman-Ford. Remove the O(n) `students.find`/`courses.find` lookups per flow edge. Cache course-to-course clashes.
5. Optional bounded search that returns `optimal: false` (a policy decision).

**Verification.** Equality of results against the current code on all existing tests and on generated datasets (the backend `verify` endpoint already replays runs, and can serve as a regression check). **Effort.** About 1 to 3 days. No policy dependency, so this can start immediately.

### 4.5 Related improvements found during the audit (not in the design document)
- Baseline random phase: use a single shuffled student order with rank-ordered rounds, round quotas with largest remainder, and roll unused merit seats into the random pool. These change outputs and need a policy decision.
- Loop the merit phase up to `maxCoursesPerStudent`.
- Consolidate the validation code that is repeated across three algorithm files (`validateInput.js` exists but is not used by them).
- Remove quadratic list copying in the clash hook and the random phase.

### 4.6 Tests still to be written

*Update 2026-11-01:* compulsory-clash, elective-group, search-limit and exactness tests now exist. Still to write: CGPA priority scenarios, once the CGPA design is chosen.
- CGPA priority scenarios (higher CGPA wins among equal assignment counts; tie rules).
- Compulsory clash scenarios for both algorithms and the validator.
- Elective-group scenarios (two courses in one group never assigned; group slots in the flow).
- Large-dataset and many-clash regression tests with a time budget.
- A property test: optimizer result with the new pruning equals the current result on random small inputs.

---

## 5. Recommended order of work

*Update 2026-11-01:* steps 1 to 3 are done. The next step is the CGPA design (step 4); see `docs/project-status-report.md` for the current plan.

| Step | Work | Needs from the college/team |
|---|---|---|
| 1 | Performance items 4.4 (1), (2), (4), (6) plus regression tests | Nothing |
| 2 | Compulsory-course constraint (4.2), pre-filter design | Compulsory timetable data and mapping |
| 3 | Elective-group constraint (4.3) | Confirm "at most one" vs "exactly one per group" |
| 4 | CGPA-aware objective (4.1) | Written definition of CGPA priority and tie rules |
| 5 | Baseline fairness changes (4.5) | Confirm they are wanted |

Steps 2 and 3 touch the same input-building code and can share one version bump. After each step: bump `ALGORITHM_VERSION`, update `docs/algorithm-design.md`, and re-run both test suites.

## 6. Questions to answer before steps 2 to 4
1. How are a student's compulsory courses identified (department, semester, section)? Who supplies their timetable?
2. Is it one course per elective group as a hard maximum, or is it compulsory to receive one from each group?
3. Strict or weighted CGPA priority? Is a high-CGPA student's second course more important than a low-CGPA student's first?
4. How are equal CGPAs resolved (id order, random, both)?
5. Should unused merit seats go to the random pool?
6. Should the optimizer's merit/random behaviour be preserved in any form, or is it purely an optimization benchmark?
