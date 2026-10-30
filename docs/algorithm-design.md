# Algorithm Design

Describes what the code in `algorithm/` actually does (algorithm version **1.1.0**), how it is validated and measured, and where it differs from the project charter in the root README. Everything here is implemented behaviour unless it is under "Not implemented" or "Ideas".

## 1. Contract

The algorithm package knows nothing about MongoDB or the UI. It receives plain data and returns plain data.

**Input**

| Field | Shape |
|---|---|
| `students` | `[{ id, name, cgpa }]` |
| `courses` | `[{ id, name, capacity }]` (an `electiveGroup` tag may be present; the algorithms ignore it) |
| `preferences` | `[{ studentId, courseId, rank }]`, rank 1 is the most preferred |
| `timetable` (optional) | `{ courseId: [{ day, start, end }] }`, times `HH:MM` |

**Options:** `maxCoursesPerStudent` (default 2), `meritRatio` / `randomRatio` (default 0.75 / 0.25, must sum to 1, baseline only), `seed` (baseline lottery).

**Output** (per algorithm): `allocations [{ studentId, courseId, preferenceRank, phase, iteration? }]`, `metrics`, `validation { valid, errors }`, `runtimeMs`, and the assumptions that were applied. `runAllocationComparison` runs both algorithms on the same input; `runSingleAllocation` runs one.

## 2. Algorithm A: baseline (merit + random)

A description of the merit/random procedure as implemented. It has **not** been confirmed against the college's official procedure (see `allocation-rules.md`).

1. **Order.** Students are sorted by CGPA descending; equal CGPAs are ordered by student id (deterministic).
2. **Quotas, per course.** `meritQuota = floor(capacity x meritRatio)`, `randomQuota = floor(capacity x randomRatio)`. Unused merit seats are **not** moved to the random quota. Because of the floors a seat can be lost: with capacity 3 and 75/25 the quotas are 2 and 0, so one seat is never given out.
3. **Merit phase, two iterations.** In each iteration, students are visited in CGPA order and each receives **at most one** course: their highest-ranked preference that still has a merit seat, that they do not already hold, that keeps them within `maxCoursesPerStudent`, and that does not clash in the timetable. Both iterations share one merit quota per course.
4. **Ties.** When a student takes the last merit seat of a course, other students with the *same CGPA* who ranked that course are admitted too, as long as the course's real capacity is not exceeded. So a course can exceed its merit quota (never its capacity).
5. **Random phase.** For each course independently, every student who ranked it is shuffled (seeded Fisher-Yates, mulberry32 PRNG) and seats are given in that order until `randomQuota` is used, skipping students who are at their limit, already hold the course, or would clash. Total capacity is never exceeded.
6. **Validation.** The combined result is validated before it is returned; a violation throws.

Reproducibility: the same input, options, seed and algorithm version give the same result.

## 3. Algorithm B: minimum-cost maximum-flow optimizer

**Network.** Source -> each student (capacity `maxCoursesPerStudent`, cost 0); student -> course for every preference (capacity 1, cost `rank - 1`); course -> sink (capacity = course capacity, cost 0).

**Objective** (lexicographic): (1) maximize the number of assignments, then (2) minimize total preference cost, i.e. the sum of `rank - 1`.

**Solver.** Successive shortest augmenting paths with Bellman-Ford (handles the negative-cost reverse edges). Worst case is about `O(F x V x E)` with `F` the flow value; measured at roughly 10 ms per solve for 200 students.

**Timetable clashes** cannot be expressed in the flow, so they are handled by search:

1. Solve the flow. If no student holds two clashing courses, the solution is feasible.
2. Otherwise take one clashing pair (student s, courses a and b). Any clash-free solution omits at least one of the two edges, so branch: forbid (s, a), or forbid (s, b), and solve each branch again.
3. A branch is dropped when its assignment count is lower than the best clash-free solution found. Visited forbidden-edge sets are not revisited.
4. Among solutions with equal assignments and equal cost, a deterministic key (the sorted list of student:course pairs) breaks the tie.

The search is exact: it returns a best clash-free solution. Clash-free assignment with capacities is a hard combinatorial problem, so the worst case is exponential in the number of clashes (see section 7).

**Policy difference.** The optimizer ignores CGPA and the merit/random quotas; it only maximizes assignments and then preference satisfaction. Its output states `meritRandomQuotasPreserved: false`. A student with a lower CGPA can receive a course over a higher-CGPA student if that improves the global result.

## 4. Independent validation

`validateAllocation` is a separate module used for both algorithms (at run time, and again by the backend before publishing). It checks: every student and course id exists; the student actually ranked the assigned course; no duplicate student-course pair; no student above the course limit; no course above capacity; no timetable clash for any student. Invalid output is rejected, never silently corrected. (The recorded preference rank and elective-group consistency are additionally checked by the backend's publication validation against the run's stored snapshot.)

## 5. Metrics and comparison

Per allocation: total assignments, students with at least one / two courses, unallocated students, capacity utilization, rank-1 and rank-2 assignments, average preference rank, and counts of capacity, student-limit, duplicate and timetable violations. The comparison reports `optimized - baseline` for each metric and the runtimes. It deliberately **declares no winner**: the two algorithms follow different policies, so "better" depends on what the college requires.

## 6. Reproducibility and audit (backend)

Each stored run keeps the normalized input snapshot, a fingerprint of it, the algorithm version, the seed and the configuration. `POST /allocations/runs/:id/verify` replays a run from that snapshot and reports any difference from the stored assignments.

## 7. Measured performance

Generated mock data (`backend/src/seed`), timetable checking on, `maxCoursesPerStudent` 2, one developer machine. Single runs, so indicative only.

| Optimizer, students | Time |
|---|---|
| 30 to 100 (most datasets) | 5 ms to 0.6 s |
| 150 | 0.2 to 1.0 s |
| 60, "many-clashes" data | 0.6 s (seed 2); over 25 s (seed 3, stopped) |
| 200, balanced data, seed 1 | 39 s (3551 flow solves) |
| 200, "many-ties" data, seed 1 | over 80 s (stopped) |

The baseline takes under 100 ms up to 1000 students. The optimizer's flow solver alone is fast (tens of milliseconds at 200 students); the time is spent in the timetable search, and it depends strongly on the data. The backend therefore runs algorithms in a worker thread with a time limit (default 60 s) and a memory cap, and warns on large timetable runs.

## 8. Differences from the project charter

The root README describes the intended problem. The current implementation differs in these ways:

- **Elective groups.** The charter asks for one course per elective group. The algorithms enforce only a global `maxCoursesPerStudent` and treat all preferences as one pool. Group tags are carried and checked by the backend (a preference list and its courses must agree on the group), but the algorithms do not require "one course from each group".
- **CGPA priority.** The optimizer does not enforce CGPA precedence. The baseline uses CGPA only for the merit seats.
- **Baseline fidelity.** The baseline is the merit/random procedure as described by the algorithm owner, not a reproduction of a documented official process.
- **Not modelled:** compulsory courses, eligibility by department or programme, prerequisites, reserved seats, multiple allocation rounds.

These need decisions from the college and the team before the system can be described as the official allocation procedure.

## 9. Ideas not implemented (for the team to decide)

Prototyped outside the repository only; no algorithm file has been changed.

- **Exact pruning.** Also drop a search branch when its cost is already worse than the best solution with the same assignment count, and start from a quickly found clash-free solution. On the datasets tried this gave identical results, with balanced-200 going from 39 s to 14 s and many-ties-200 from over 80 s to 7 s. Identical results were confirmed on nine mid-size cases where the current code finishes.
- **Bounded search.** An optional limit on the search that returns the best clash-free solution found so far, flagged `optimal: false`. This changes what the optimizer may return, so it needs an explicit decision.
- **Group-aware model.** Per student-and-group slots in the network, as in the charter, and a CGPA-aware or lexicographic objective. Both depend on the confirmed policy.
