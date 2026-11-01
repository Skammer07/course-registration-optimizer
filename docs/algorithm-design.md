# Algorithm Design

Describes what the code in `algorithm/` actually does (algorithm version **1.5.1**), how it is validated and measured, and where it differs from the project charter in the root README. Everything here is implemented behaviour unless it is under "Not implemented" or "Ideas".

## 1. Contract

The algorithm package knows nothing about MongoDB or the UI. It receives plain data and returns plain data.

**Input**

| Field | Shape |
|---|---|
| `students` | `[{ id, name, cgpa }]` |
| `courses` | `[{ id, name, capacity, electiveGroup? }]`. A course with no `electiveGroup` is **open**: it can be in the list of every group (one shared pool of seats). A course with a group is offered to that group only. |
| `preferences` | `[{ studentId, courseId, rank, electiveGroup? }]`. `electiveGroup` names the priority list (OE1, OE2, ...) the record belongs to; `rank` 1 is the most preferred in that list. Each group is an independent list of up to 15 courses, and the same course may be in several of a student's lists. |
| `timetable` (optional) | `{ courseId: [{ day, start, end }] }`, times `HH:MM` |
| `fixedTimetable` (optional) | `{ studentId: [{ day, start, end }] }`: each student's compulsory-course slots. Used only together with `timetable`. |

**Options:** `maxCoursesPerStudent` (default 2), `meritRatio` / `randomRatio` (default 0.7 / 0.3 as in the IIT (ISM) UG manual, must sum to 1, baseline only, and the optimizer when it is held to the baseline), `seed` (baseline lottery), `oneCoursePerGroup` (default true), `optimizerFloor` (`"baseline"` by default, or `"none"`), `cgpaPriority` (default true).

**Output** (per algorithm): `allocations [{ studentId, courseId, preferenceRank, phase, iteration?, electiveGroup? }]` (`electiveGroup` is the list the course was given for), `metrics`, `validation { valid, errors }`, `runtimeMs`, and the assumptions that were applied. `runAllocationComparison` runs both algorithms on the same input; `runSingleAllocation` runs one.

## 2. Algorithm A: baseline (merit + random)

A description of the merit/random procedure as implemented. It has **not** been confirmed against the college's official procedure (see `allocation-rules.md`).

1. **Order.** Students are sorted by CGPA descending; equal CGPAs are ordered by student id (deterministic).
2. **Quotas, per course.** `meritQuota = round(capacity x meritRatio)` and `randomQuota = capacity - meritQuota`, so no seat is lost to rounding (capacity 10 gives 7 and 3, capacity 4 gives 3 and 1). Unused merit seats are **not** moved to the random quota. Ties can still push a course above its merit quota but never above its capacity.
3. **Merit phase.** Without elective groups: two iterations, in each of which students are visited in CGPA order and each receives **at most one** course (their highest-ranked preference that still has a merit seat, that they do not already hold, that keeps them within `maxCoursesPerStudent`, and that does not clash in the timetable). With elective groups (each group an independent priority list): **students are served strictly in CGPA order**, and each student in turn takes, for every group, the best-ranked course of *that group's* list that still has a merit seat, that they do not already hold, and that does not clash. A student holds at most one course per group and never the same course twice, even when it is in both lists. Because the highest-CGPA student finishes before the next starts, CGPA priority holds across the whole shared pool. Both cases share one merit quota per course.
4. **Ties.** When a student takes the last merit seat of a course, other students with the *same CGPA* who ranked that course are admitted too, as long as the course's real capacity is not exceeded. So a course can exceed its merit quota (never its capacity).
5. **Random phase.** Without groups: for each course independently, every student who ranked it is shuffled (seeded Fisher-Yates, mulberry32) and seats are given in that order until `randomQuota` is used. With groups: for each group, the students who still hold no course of that group are put in a seeded random order and each takes the **best-ranked course of that group's list that still has a lottery seat** (skipping courses they already hold), so nobody gets a low choice while a higher choice of theirs had a free seat. Students at their limit or clashing in the timetable are skipped; capacity is never exceeded.
6. **Validation.** The combined result is validated before it is returned; a violation throws.

Reproducibility: the same input, options, seed and algorithm version give the same result.

## 3. Algorithm B: minimum-cost maximum-flow optimizer

**Network.** Source -> each student (capacity `maxCoursesPerStudent`, cost 0); student -> course for every preference (capacity 1, cost `rank - 1`); course -> sink (capacity = course capacity, cost 0). With elective groups there is one extra node per (student, group) between the student and that group's list, with capacity 1, so "at most one course per group" is part of the flow itself (exact, no search). When the same course is in two of a student's lists, one more node (capacity 1) sits in front of the course so the student cannot receive it twice; the cost of each edge is the course's rank in that group's list. The network is built once and reused for every branch of the search.

**Objective** (lexicographic): (1) maximize the number of assignments, then (2) minimize total preference cost, i.e. the sum of `rank - 1`.

**Solver.** Successive shortest augmenting paths with Bellman-Ford (handles the negative-cost reverse edges). Each pass scans only nodes whose distance changed since their last scan, which picks the same paths as a full pass. Worst case is about `O(F x V x E)` with `F` the flow value.

**Timetable clashes** cannot be expressed in the flow, so they are handled by search:

1. Solve the flow. If no student holds two clashing courses, the solution is feasible.
2. Otherwise take one clashing pair (student s, courses a and b). Any clash-free solution omits at least one of the two edges, so branch: forbid (s, a), or forbid (s, b), and solve each branch again.
3. Branches are explored best-first: the one with the most assignments, then the lowest cost, is expanded first. Forbidding edges can only remove options, so a branch's own flow solution bounds everything below it. A branch is dropped when it has fewer assignments than the best clash-free solution found, or the same number at a higher cost. Branches with an equal cost are kept so the tie-break below sees every optimal solution. Visited forbidden-edge sets are not revisited.
4. Among solutions with equal assignments and equal cost, a deterministic key (the sorted list of student:course pairs) breaks the tie.
5. Whether two courses overlap is looked up once per course pair and cached.

**Search limit (optional).** `maxFlowSolves` and `searchTimeLimitMs` bound the timetable search. With a limit the optimizer first builds a clash-free answer greedily (while any student holds two clashing courses, forbid the worse-ranked course of one clashing pair per student and solve again), then keeps improving it with the search above until the limit is reached. If the limit stops the search, the output says `assumptions.optimal: false`, gives `searchStopReason`, and gives `searchBound`: the most assignments any answer could still reach and, for that many, the lowest possible preference cost. The returned answer is always valid and clash-free. The solve limit is deterministic (the same input stops at the same point); the time limit is a safety net and is not. Without a limit the search is exact, as described next. A third limit, `maxWork`, counts the edges the flow solver looks at; unlike time it is identical on every machine, so a run stopped by it stops at the same point every time and reproduces. The backend sets 2.5 billion edges of work (about 12 seconds on a typical machine), 2000 solves and 30 seconds (the time limit is only a safety net).

The unlimited search is exact: it returns a best clash-free solution. Clash-free assignment with capacities is a hard combinatorial problem, so the worst case is exponential in the number of clashes (see section 7).

### Held to the baseline, and CGPA inside the optimizer (default)

The CGPA used throughout is the **cumulative CGPA up to the previous semester, as it stands at pre-registration** (the student's `cgpa`).

**Floor ("nobody ends worse than the baseline").** With `optimizerFloor: "baseline"` (the default) the optimizer is given the baseline's own allocation and may only use, for every (student, group) the baseline filled, courses ranked at least as high as the one the baseline gave, and must still fill that slot. Everything else is unchanged: capacity, one course per group, never the same course twice, the timetable, compulsory classes. The baseline's result obeys all of these, so it is always a valid answer, and the optimizer starts from it. Consequences:
- the result has at least as many assignments and at most the total preference cost of the baseline, and **no student is worse off in any group**, including the students with the highest CGPA;
- among all valid allocations that respect the floor, the optimizer returns one with the most assignments and then the lowest total preference cost (exact when `optimal` is true; otherwise `searchBound` says how much better it could be, and the result is never worse than the floor even if the search is stopped at once);
- filled baseline slots are protected inside the flow by a large bonus on the student-to-group edge, and any search branch that can no longer keep every such slot is discarded;
- the greedy first answer (used when the search is limited) resolves each timetable clash by dropping the worse-ranked course, but never a course the baseline gave that student, so it keeps every slot and can only improve on the floor (version 1.5.1; before that, large inputs returned the floor unchanged);
- the floor applies to runs with elective groups; without groups it is ignored (`assumptions.floorApplied: false`);
- it depends on the baseline's lottery draw, so an optimizer-only run recomputes the baseline from the stored seed and split (the comparison run uses one seed for both).

**CGPA priority.** With `cgpaPriority: true` every edge costs `(rank - 1) * (BIG + weight)`, where the weight grows with the student's CGPA and `BIG` is larger than every weighted part added together. The real preference cost therefore always decides first, and the weighted part only decides **between allocations that cost the same**, in favour of higher CGPA. The reported cost is always the plain `sum(rank - 1)`. If the numbers would become too large to stay exact (about 1,500 students and more), the weighting switches itself off and the output says so (`assumptions.cgpaPriority: false`).

**Measuring it.** `cgpaPriorityViolations` counts the cases where a student ranked a course above the one they received (or received nothing in that group), a student with a **lower CGPA** holds that course, and the student could have taken it (no clash, not already held). The baseline has some by design (its 30% lottery); zero would mean strict CGPA order everywhere, which the floor does not promise. The run page shows the count for both algorithms and a better / same / worse comparison per student.

**Without the floor** (`optimizerFloor: "none"`) the optimizer ignores the baseline: it maximizes assignments and then preference cost, and a student with a lower CGPA can receive a course over a higher-CGPA student if that improves the global result. Its output states `meritRandomQuotasPreserved: false` in both modes.

### Compulsory-course slots (`fixedTimetable`)

A student's compulsory courses are not allocated, but they occupy part of the week. When `fixedTimetable` is supplied, no algorithm gives a student an elective that overlaps one of that student's fixed slots (same day, overlapping times; back-to-back is fine).

- **Optimizer:** preferences that overlap the student's fixed slots are removed before the network is built. This is exact and adds no branching. The count is reported as `assumptions.preferencesRemovedByFixedSlots`.
- **Baseline:** the merit phase (including tied-CGPA admissions) and the random phase both check the fixed slots through the same `canEnroll` hook as elective-to-elective clashes.
- **Validator and metrics:** an allocation that overlaps a fixed slot is an error, and is counted in `timetableClashes`.
- Without `fixedTimetable` (or with an empty one) the results are the same as a run that has no compulsory-course support.

The backend builds `fixedTimetable` from compulsory courses (`kind: "compulsory"`): a student gets the slots of every active compulsory course of the semester whose `departments` include the student's department (case and spacing ignored).

## 4. Independent validation

`validateAllocation` is a separate module used for both algorithms (at run time, and again by the backend before publishing). It checks: every student and course id exists; no allocation overlaps the student's fixed (compulsory) slots when `fixedTimetable` is given; the student actually ranked the assigned course; no duplicate student-course pair; no student above the course limit; no course above capacity; no timetable clash for any student; and, when `oneCoursePerGroup` is on, no student with two courses of one elective group. Invalid output is rejected, never silently corrected. (The recorded preference rank and elective-group consistency are additionally checked by the backend's publication validation against the run's stored snapshot.)

## 5. Metrics and comparison

Per allocation: total assignments, students with at least one / two courses, unallocated students, capacity utilization, rank-1 and rank-2 assignments, average preference rank, and counts of capacity, student-limit, duplicate, timetable and group-limit violations. Two group measures are added: `studentsMissingAGroup` (ranked a group but received nothing from it) and `groupLimitViolations` (extra courses beyond one per group; must be 0). Timetable clashes include overlaps with a student's compulsory slots. The comparison reports `optimized - baseline` for each metric and the runtimes. It deliberately **declares no winner**: the two algorithms follow different policies, so "better" depends on what the college requires.

## 6. Reproducibility and audit (backend)

Each stored run keeps the normalized input snapshot, a fingerprint of it, the algorithm version, the seed and the configuration. `POST /allocations/runs/:id/verify` replays a run from that snapshot and reports any difference from the stored assignments. Runs stored before version 1.3.0 do not carry `oneCoursePerGroup` and are replayed and re-validated without the group rule.

## 7. Measured performance

Generated mock data (`backend/src/seed`), timetable checking on, `maxCoursesPerStudent` 2, one developer machine. Single runs, so indicative only.

| Optimizer, students | Before (earlier version) | Now |
|---|---|---|
| 30 to 100 (most datasets) | 5 ms to 0.6 s | a few ms |
| 150, balanced / many-ties | 0.2 s | 0.04 to 0.12 s |
| 60, "many-clashes" data, seed 2 | 0.9 s (795 flow solves) | 0.23 s (393) |
| 60, "many-clashes" data, seed 3 | over 100 s (stopped) | 3.5 s |
| 200, balanced data, seed 1 | 50 s (3551 flow solves) | 7.7 s (1077) |
| 200, "many-ties" data, seed 1 | over 100 s (stopped) | 3.9 s |

Measured with `algorithm/scripts/benchmarkOptimizer.js` on one developer machine, single runs, so indicative only. The benchmark treats every course as ungrouped, so these rows measure the search without the group rule (which makes the search smaller, see the last paragraph). On every case the earlier version could finish (balanced 150 and 200, many-ties 150, many-clashes 40 and 60 seed 2) the assignments are identical; for the two cases it could not finish within 100 s there is nothing to compare with, but the new result is checked by `tests/optimizedExact.test.js` (exhaustive search on small inputs).

The baseline takes under 100 ms up to 1000 students. The optimizer's flow solver alone is fast (tens of milliseconds at 200 students); the time is spent in the timetable search, and it depends strongly on the data. The backend therefore runs algorithms in a worker thread with a time limit (default 60 s) and a memory cap, and warns on large timetable runs.

### Compulsory-course data (200 students, 36% of choices overlapping)

On a 200-student, 20-elective dataset (two separate groups of ten) where eight compulsory courses overlapped 900 of 2505 ranked electives:

- **Without the group rule**, the exact search did not finish in 120 s (6.5 s without the compulsory slots). With the default search limit the optimizer finished in 9.3 s with all 400 possible assignments, cost 330, and a proven lower bound of 324 (within 2 %).
- **With one course per group (version 1.3.0 onward, the default)** the optimizer finished the exact search in 4.2 s and proved its result optimal (381 assignments, cost 402, average rank 2.06). The baseline (70/30, 0.06 s) gave 363 assignments, average rank 2.20. Students with a course in both groups: 181 (optimizer) against 163 (baseline); students missing a group: 19 against 37. No student held two courses of one group.

Single runs on one machine. The optimizer ignores CGPA, so this is not yet a like-for-like comparison with the baseline.

### Held to the baseline (100 students, 20 courses; and 200 students, 25 courses)

Generator scenario `open-electives`, baseline 70/30. Single runs. "Worse" counts results ranked lower than the baseline's, or lost.

| 100 students, 20 courses | Average rank | Worse than baseline | Top-20% CGPA avg | Rest avg | Worst rank | CGPA-priority violations |
|---|---:|---:|---:|---:|---:|---:|
| Baseline | 2.15 | – | 1.05 | 2.43 | 15 | 157 |
| Optimizer without the floor (before) | 1.20 | 18 | 1.20 | 1.20 | 3 | 33 |
| **Optimizer held to the baseline, with CGPA** | **1.25** | **0** | **1.05** | **1.30** | **3** | **43** |

At 200 students and 25 courses: baseline 1.88 (violations 263), unconstrained optimizer 1.17 with 37 students worse (violations 42), held to the baseline **1.26 with 0 worse (violations 73)**. High-CGPA students keep exactly their baseline result; the others improve a lot. The floor also shrinks the search: at 200 students it took 1.3 s and was proven optimal, against 8 s and not proven without it. The price of the guarantee is 0.05 to 0.09 of average rank.

### Held to the baseline at 500 students

Generator scenario `open-electives`, 70/30 baseline, seed 1. Single runs on one machine; the 16 s figure is the same data run through the backend.

| 500 students, 40 courses (1,213 seats for 1,000 slots) | Average rank | Worse than baseline | Top-20% CGPA avg | Rest avg | CGPA-priority violations | Proven optimal | Time |
|---|---:|---:|---:|---:|---:|---|---:|
| Baseline | 1.99 | – | 1.05 | 2.22 | 848 | – | 0.05 s |
| Optimizer without the floor | 1.27 | 114 | 1.30 | 1.26 | 222 | No | 8 s |
| **Optimizer held to the baseline, with CGPA** | **1.41** | **0** | **1.05** | **1.50** | **338** | No | 8 to 16 s |

At 500 students the search stops at its work limit, so the result is valid and never worse than the baseline for any student, but not proven optimal (127 students better, 873 the same). Version 1.5.0 returned exactly the baseline here (average 1.99): its greedy first answer gave up a student's baseline course when two courses clashed, lost the slot, and was discarded, so nothing better than the floor was ever found. Version 1.5.1 never gives up a baseline course in that first step; 100 and 200 students are unchanged and still proven optimal.

### Open electives (shared pool, 200 students)

On a 200-student dataset with one shared pool of 25 open electives and two independent lists of 15 choices per student (OE1 and OE2; generator scenario `open-electives`): the baseline (70/30, 0.07 s) filled all 400 slots with an average rank of 1.88; the optimizer filled all 400 with an average rank of 1.17 (total cost 68 against 352 for the baseline) and stopped at its work limit after about 12 s, with a proven lower bound of 62, so it is within about 10 % of the best possible cost. No student held a course twice or two courses of one group. Single run, one machine.

## 8. Differences from the project charter

The root README describes the intended problem. The current implementation differs in these ways:

- **Elective groups.** Implemented: each group (OE1, OE2, ...) is an independent priority list of up to 15 courses; a course with no group is open to every group and the lists draw from one shared pool; each student gets **at most one course per group and never the same course twice**. Both algorithms try to fill every group a student ranked, but a group stays empty when no seat or clash-free slot is left. The rule is exact in the optimizer, and `oneCoursePerGroup: false` restores the old total-only limit. Not modelled: a guaranteed minimum.
- **CGPA priority.** Built in as the floor plus a CGPA tie-break (section 3). Not guaranteed: strict CGPA order everywhere (the baseline's 30% lottery lets a lower CGPA win a seat by design, and the floor protects baseline results).
- **Baseline fidelity.** The 70/30 split and the per-slot priority lists follow the IIT (ISM) UG manual. The rest (for example the two-iteration merit pass when there are no groups, the tie rule, and lottery seats not reused) is the algorithm owner's description, not a documented official process.
- **Compulsory courses:** modelled only as fixed time slots per student (section 3). Which students take which compulsory course comes from the course's `departments`; there is no section or study-semester matching yet.
- **Not modelled:** eligibility by department or programme for electives, prerequisites, reserved seats, the second allocation round for students left without a course, the 10-student minimum to run an elective, courses with similar content, half-semester (modular) courses.

These need decisions from the college and the team before the system can be described as the official allocation procedure.

## 9. Not implemented yet / ideas (for the team to decide)

**Done since the first version of this document:** cost-based pruning and best-first order, the search limit with an `optimal` flag, compulsory courses as fixed slots, one course per elective group, the 70/30 default, the optimizer held to the baseline's result and using CGPA, the CGPA-priority check.

**Open, depends on the confirmed policy**
- **Stricter CGPA priority.** The floor protects the baseline's results, lottery winners included. A variant could let a higher-CGPA student take a seat that a lower-CGPA student won in the lottery (the user-visible `cgpaPriorityViolations` shows how many there are); that needs a policy decision on whether lottery seats are protected. A CGPA weight that trades preference cost for CGPA is also possible.
- **Second round** for students left without a course (choose from vacant seats), a **random fill** when a student lists fewer than 15 choices, the **10-student minimum**, **department eligibility** for electives and **similar-content** exclusions, as described in the UG manual.
- **Half-semester courses:** slots would need a first-half / second-half marker so that two such courses in one slot are not a clash.

**Open, no policy needed**
- **Re-solve a branch from its parent's flow** instead of from scratch (cancel one path, repair, augment). With the shared pool each solve costs about 45 ms at 200 students, so the search proves optimality only on smaller inputs.
- Encode identical-slot clash groups inside the flow network (removes much of the branching exactly), and re-solve a branch from its parent's flow instead of from scratch.
- A Dijkstra-with-potentials solver was tried and rejected: it was not faster on these graphs and it picks different equal-cost solutions, so results would no longer match earlier runs.
