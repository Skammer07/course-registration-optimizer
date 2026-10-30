# API Contract

Base URL: `http://localhost:5000` (dev). All API routes are under `/api/v1`. Interactive docs: `/api-docs` (development only).

This is the contract for the frontend. The frontend must **display** results from the API and must not re-implement allocation logic. Allocation inputs are **not** sent in the request: the backend loads students, courses, preferences and timetable slots from MongoDB for the requested `semesterId`.

## Conventions

- **Auth:** `POST /auth/login` sets an HTTP-only cookie `token` (JWT, 15 min). Send requests with `credentials: "include"`. Roles: `student`, `faculty`, `admin`.
- **Success:** `{ "success": true, "message": "...", "data": { ... } }`
- **Failure:** `{ "success": false, "error": { "code": "...", "message": "...", "details": [] } }` (no stack traces).
- **Status codes:** `400` validation, `401` not logged in, `403` wrong role, `404` not found, `409` conflict (publish state), `422` publication validation failed, `429` rate limited, `500` server error, `504` allocation timed out.
- **Request id:** every response has an `X-Request-Id` header (a client-sent id of up to 64 letters, digits, `.`, `_` or `-` is reused; otherwise a UUID is generated). Error bodies also carry it as `requestId`, so a user can quote it when reporting a problem. The header is exposed to browsers via CORS.
- **Pagination:** `?page=1&limit=50`; list responses include `total`, `page`, `limit`, `totalPages`.

## Health

`GET /health` (no login). `200` when healthy, `503` when the database or the algorithm package is unavailable.
```
{ success, status ("ok"|"degraded"), timestamp, uptimeSeconds,
  services { database ("connected"|...), algorithm ("available"|"unavailable") },
  algorithmVersion, activeRuns }
```
`activeRuns` is the number of allocation runs computing right now in this server process.

## Auth

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/auth/login` | public | body `{ email, password }`; rate limited |
| POST | `/auth/logout` | public | clears cookie |
| GET | `/auth/me` | any | current user (includes `mustChangePassword`); allowed even with a temporary password |
| POST | `/auth/change-password` | any logged in | `{ currentPassword, newPassword }` (8 to 128 chars, must differ). Clears `mustChangePassword`, invalidates every older token and sets a fresh cookie. Rate limited like login. Wrong current password: `400 INVALID_CURRENT_PASSWORD` |

## Students / Courses / Preferences / Users

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/students` | admin, faculty | paginated |
| GET | `/students/:id` | any | a student may read only their own record |
| POST / PATCH | `/students`, `/students/:id` | admin, faculty | PATCH of cgpa, semesterId, electiveGroups, isActive is admin only |
| DELETE | `/students/:id` | admin | soft deactivate |
| GET | `/courses`, `/courses/:id` | any | paginated list |
| POST / PATCH | `/courses`, `/courses/:id` | admin, faculty | includes `timetableSlots: [{ day, start, end }]` |
| DELETE | `/courses/:id` | admin | soft deactivate |
| GET | `/preferences/me` | student | own preferences |
| PUT | `/preferences/me` | student | body `{ semesterId, electiveGroup, rankedCourseIds: [courseId...], status: "draft" \| "submitted" }`; rank = array position |
| GET | `/preferences`, `/preferences/:id` | admin, faculty | paginated. Filters: `semesterId`, `electiveGroup`, `status`, `student` (the student's `_id`; ranked courses are populated with `courseCode`, `title`) |
| GET | `/preferences/overview` | admin, faculty | who has submitted: query `semesterId` (required), `search`, `department`, `status=all\|complete\|incomplete\|none`, `includeInactive`, `page`, `limit` (max 200). Returns `{ semesterId, groups, departments, summary: { students, complete, incomplete, none, perGroup: { G: { submitted, draft, missing } } }, students: [{ _id, studentId, name, cgpa, department, electiveGroups, isActive, status, groups: { G: { status: submitted\|draft\|missing\|na, count } } }], total, page, limit, totalPages }`. `summary` ignores the filters and counts active students only. A student is expected to have one list per group of their `electiveGroups` (every group of the semester when none is set) |
| POST | `/users` | admin | create a login; `role: "student"` needs `studentId`. **Omit `password`** to get a server-generated one-time `temporaryPassword` in the response (`mustChangePassword: true`) |
| GET | `/users` | admin | list logins: `?role=`, `?isActive=`, `?search=` (email), `page`, `limit` (default 50, max 200); never returns password data |
| GET | `/users/:id` | admin | one login |
| PATCH | `/users/:id/status` | admin | `{ "isActive": true \| false }`. You cannot deactivate yourself or the last active admin (`409`). Takes effect on the user's very next request |
| POST | `/users/:id/reset-password` | admin | new one-time `temporaryPassword`, forced change, all older tokens invalidated. Not allowed on your own account |

## Passwords, imports and the first admin

**Temporary passwords.** Created by `POST /users` without a password, by an admin reset, by a student CSV import with `createLogins=true`, and by `create-admin`. They are 12 characters (upper, lower, digit, no look-alikes), shown **once** in the response (`Cache-Control: no-store`), stored only as an argon2 hash and never logged. While `mustChangePassword` is true every route except `GET /auth/me` and `POST /auth/change-password` answers `403 PASSWORD_CHANGE_REQUIRED` (the UI should send the user to a change-password screen). There is no email: the admin hands the password over.

**Token invalidation.** A password change or reset rejects every token issued before it (`401`). A deactivated user is rejected on the next request.

### CSV imports (admin)

`POST /imports/students`, `/imports/courses`, `/imports/preferences` with the CSV as the body (`Content-Type: text/csv`, UTF-8, max 2 MB and 5000 rows). Header names are case-insensitive. Query options: `dryRun=true` (validate and report, write nothing), `onExisting=skip` (default) or `update` (empty cells never overwrite), `createLogins=true` (students only, max 500 logins per import), `status=draft|submitted` (preferences only, default `submitted`).

| Import | Required columns | Optional columns |
|---|---|---|
| students | `studentId,name,cgpa` | `department,semesterId,electiveGroups` (separate groups with `;`), `isActive`, `email` (required on every row with `createLogins=true`) |
| courses | `courseCode,title,capacity,semesterId,electiveGroup` | `timetable` (like `Monday 09:00-10:00; Wed 11:00-12:00`, full or 3-letter weekdays), `isActive` |
| preferences | `studentId,semesterId,electiveGroup,courseCode,rank` | none. One row per ranked course; the list order is the rank order |

**Validation is all-or-nothing.** Any problem returns `422 IMPORT_VALIDATION_FAILED` with `details: [{ row, column, message }]` (row = line number in the file, up to 50 shown, the message says how many in total) and nothing is written. Preference rows are checked like a student submission: the student is active, registered for that semester and eligible for the group; each course exists, is active, and is in that semester and group; no repeated rank or course. Admin imports bypass the preference deadline.

**Success response `data`:** `{ dryRun, totalRows, created, updated, skipped, ... }`. Students add `loginsCreated`, `skippedStudentIds` and, when logins were created, `credentials: [{ studentId, email, temporaryPassword }]` plus `credentialsCsv` (ready to save; shown once). Preferences add `lists` and `status`. If a later step fails, records the import created are removed again (`500 IMPORT_FAILED`).

### First admin (command line)

```
node scripts/create-admin.js --email admin@college.edu          # prints a one-time password
node scripts/create-admin.js --email admin@college.edu --reset  # recover an existing admin
```
(`npm run create-admin -- ...` also works outside PowerShell.) Needs `MONGODB_URI` and `JWT_SECRET`, and works in production. It never changes a non-admin account.

## Semesters and preference deadlines

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/semesters/:semesterId/status` | any logged in | UI banner data. Students may only read their own semester; `me` resolves to the student's semester (admin/faculty must pass a real id) |
| GET | `/semesters` | admin, faculty | list semester records |
| GET | `/semesters/:semesterId/demand` | admin, faculty | how many submitted lists rank each course: `{ semesterId, lists, studentsWithLists, courses: [{ courseId, courseCode, ranked, firstChoice, secondChoice }] }`; courses nobody ranked appear with zeros |
| GET | `/semesters/overview` | admin, faculty | every semester that has data or a record, with what each holds (for pickers): `[{ semesterId, name, recordExists, students, courses, preferenceLists, runs, published }]`. Counts cover active students, active courses and submitted preference lists. Data entered by the seed script or CSV imports has no record but still appears. Sorted: semesters with students first, then by id |
| POST | `/semesters` | admin | `{ semesterId, name?, preferencesOpenAt?, preferencesCloseAt? }` (ISO dates; close must be after open); duplicate is `409` |
| PATCH | `/semesters/:semesterId` | admin | change name or dates (`null` clears a date) |
| PUT | `/semesters/:semesterId/preferences-state` | admin | `{ "state": "open" \| "closed" \| "auto" }`: force open/closed, or `auto` to follow the dates. Creates the record if missing |

**Status values** (`data.status`): `preferences-not-open`, `preferences-open`, `allocation-pending` (closed, nothing published), `results-published`. Also returned: `preferencesOpen`, `opensAt`, `closesAt`, `override`, `resultsPublished`, `publishedRun`, `recordExists`.

**Rules**
- A semester with no record counts as open (existing data keeps working).
- Manual override beats the dates. Without an override: open when `now >= preferencesOpenAt` (if set) and `now < preferencesCloseAt` (if set).
- `PUT /preferences/me` (draft or submitted) outside the window returns `403` with code `PREFERENCES_CLOSED`.
- Publishing a run sets the semester to closed automatically (an admin can reopen it explicitly).
- Starting a run while a semester's preferences are still open is allowed, but a warning is added to the run's `inputWarnings.messages`.

## Student results (published data only)

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/allocations/my-results` | student | the logged-in student's own PUBLISHED assignments |
| GET | `/allocations/published?semesterId=` | any logged in | which run (algorithm, publish date) is published for a semester; students need not pass `semesterId` and get `403` for another semester |

`my-results` response `data`:
```
{ student { studentId, name }, semesterId, published (bool),
  run { id, semesterId, algorithm, publishedAt } | null,
  assignments [ { course { courseCode, title, electiveGroup }, preferenceRank, phase } ],
  summary { coursesAllocated, maxCoursesPerStudent, message } | null }
```
Before anything is published: `published: false`, `assignments: []`. If the student received no course: `published: true`, empty `assignments`, and `summary.message` explains it. Identity comes only from the login; no CGPA, other students, metrics or proposed (unpublished) rows are ever returned. A student account not linked to a student record gets `400`.

## Allocations (admin unless stated)

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/allocations/compare` | admin | run **both** algorithms in one run |
| POST | `/allocations/run` | admin | run **one** algorithm (`baseline` or `optimized`) |
| GET | `/allocations/runs` | admin, faculty | list runs (`?algorithm=`, `?semesterId=`, `?status=`, paginated; default limit 20, max 100) |
| GET | `/allocations/runs/:runId` | admin, faculty | one run: metrics, validation, runtime, policy details, input snapshot |
| GET | `/allocations/runs/:runId/results` | admin, faculty | raw assignments (paginated; default limit 100, max 500). Filters: `algorithm`, `phase` (`merit`\|`random`), `rank`, `courseCode`, `studentId`; `sort` = `default`\|`rank`\|`-rank`\|`phase` |
| GET | `/allocations/runs/:runId/export` | admin, faculty | CSV download of one algorithm's assignments (`?algorithm=`; optional when published or single-algorithm) |
| POST | `/allocations/runs/:runId/cancel` | admin | cancel a `running` run |
| DELETE | `/allocations/runs/:runId` | admin | delete a run that was never published (`completed`, `failed`, `cancelled`) and its assignments |
| POST | `/allocations/runs/:runId/verify` | admin | replay check: re-run from the stored snapshot and compare with the stored assignments (`?algorithm=`, both when omitted) |
| GET | `/allocations/runs/:runId/summary` | admin, faculty | dashboard summary: both algorithms side by side in one call |
| GET | `/allocations/runs/:runId/results/by-student` | admin, faculty | one row per student (including unallocated) |
| GET | `/allocations/runs/:runId/results/by-course` | admin, faculty | one row per course: seats, utilization, demand |
| GET | `/allocations/runs/compare?runA=&runB=` | admin, faculty | side-by-side of two stored runs (`&algorithmA=&algorithmB=` when a run holds both) |
| POST | `/allocations/runs/:runId/publish` | admin | publish one algorithm's results |

### POST /allocations/compare

```json
{ "semesterId": "SEM-1", "maxCoursesPerStudent": 2, "meritRatio": 0.75, "randomRatio": 0.25,
  "includeTimetable": true, "seed": 42 }
```
Only `semesterId` is required. `meritRatio + randomRatio` must equal 1. `seed` (0 to 4294967295) makes the baseline lottery reproducible; omitted means a seed is generated and stored. Returns `201 { data: { run } }`.

### POST /allocations/run

Same body plus `"algorithm": "baseline" | "optimized"` (required). `meritRatio`, `randomRatio` and `seed` apply to `baseline` only and are rejected for `optimized`. Returns `201 { data: { run } }`.

### The `run` object (key fields)

```
_id, semesterId, status ("completed"|"failed"|"publishing"|"published"|...), algorithmsRun ["baseline","optimized"],
algorithmVersion, randomSeed, inputFingerprint,
configuration { maxCoursesPerStudent, meritRatio, randomRatio, timetableValidationEnabled },
baselineMetrics / optimizedMetrics {
  totalAssignments, studentsWithAtLeastOneCourse, studentsWithTwoCourses, unallocatedStudents,
  totalCapacity, capacityUtilization, rank1Assignments, rank2Assignments, averagePreferenceRank,
  capacityViolations, studentLimitViolations, duplicateAssignments, timetableClashes, constraintViolations },
baselineValidation / optimizedValidation { valid, errorCount, errorList },
baselineRuntimeMs, optimizedRuntimeMs, totalRuntimeMs,
comparison { improvement, validComparison, note },
algorithmDetails {
  baseline:  { phaseSummary { merit { allocated }, random { allocated } }, assumptions: [strings] },
  optimized: { assumptions { objective, flowSolves, conflictBranches, meritRandomQuotasPreserved: false },
               totalPreferenceCost } },
inputWarnings { skippedPreferences, droppedCourseEntries, messages },
selectedAlgorithm, publishedAt
```
`inputSnapshot` (full students/courses/preferences) is returned only by `GET /runs/:runId`, never in lists.

**Policy note for the UI:** the baseline keeps separate merit (CGPA) and random quotas per course; the optimizer maximizes the number of assignments and then minimizes preference cost, and does **not** preserve those quotas or CGPA priority. Show `comparison.note` and `algorithmDetails` so users see this. No winner is declared by the API.

### GET /allocations/runs/:runId/results

`data: { run, allocations: [{ algorithm, student: { studentId, name, cgpa, department }, course: { courseCode, title, capacity, electiveGroup }, preferenceRank, phase, status }], total, page, limit, totalPages }`. `phase` is `"merit"` or `"random"` for the baseline and null for the optimizer. `status` is `"proposed"` or `"published"`.

### Dashboard views (admin / faculty)

**`GET /runs/:runId/summary`** returns, in one call:
```
{ run { id, semesterId, status, errorSummary, algorithmsRun, algorithmVersion, randomSeed,
        selectedAlgorithm, publishedAt, createdAt, totalRuntimeMs, configuration,
        inputCounts { students, courses, preferences, timetableIncluded }, publicationCheck },
  algorithms { baseline | optimized (null if not in the run): { algorithm, metrics, runtimeMs,
        validation { valid, errorCount, errorList }, details (phaseSummary/assumptions), published } },
  comparison { available, difference (optimized minus baseline, incl. runtimeMs), note, warnings } }
```
The input snapshot lists (students, CGPAs) are never included. `comparison.available` is false for single-algorithm runs.

**`GET /runs/:runId/results/by-student`** and **`.../by-course`** show one algorithm's rows. `algorithm` may be omitted when the run is published (the published algorithm is used) or contains only one algorithm; otherwise it is required (`400`). Only completed, publishing or published runs are viewable.

- by-student query: `algorithm`, `search` (id or name), `status` (`all`\|`allocated`\|`unallocated`), `sort` (`studentId`\|`name`\|`cgpa`\|`coursesAllocated`\|`averageRank`), `page`, `limit` (default 50, max 200). Row: `{ studentId, name, cgpa, status, coursesAllocated, averageRank, courses: [{ courseCode, title, electiveGroup, preferenceRank, phase }] }`. Students who got nothing are included (taken from the run's stored snapshot).
- by-course query: `algorithm`, `search` (code or title), `sort` (`courseCode`\|`utilization`\|`assignedCount`\|`demand`), `includeStudents` (default true), `page`, `limit`. Row: `{ courseCode, title, electiveGroup, capacity, assignedCount, seatsRemaining, utilization, demand (students who ranked it), byPhase, students: [{ studentId, name, preferenceRank, phase }] }`.
- Both responses include `snapshotAvailable`, `total`, `page`, `limit`, `totalPages`.

### Export, cancel, delete and verify

- **Export** returns `text/csv` (UTF-8 with BOM, CRLF lines) as an attachment named like `allocation-<semester>-<algorithm>-<runtail>.csv`. Columns: `runId, semesterId, algorithm, studentId, studentName, cgpa, department, courseCode, courseTitle, electiveGroup, preferenceRank, phase, iteration, status`. Text cells starting with `=`, `+`, `-` or `@` are prefixed with a quote so spreadsheets cannot run them as formulas.
- **Cancel** works only on a `running` run (`409` otherwise). The run becomes `cancelled`, its worker is stopped, and the request that started the run answers `409 ALLOCATION_CANCELLED`. Response `data`: `{ run, workerStopped }`; `workerStopped: false` means no live worker existed in this server process (for example after a restart), and the stale run was just marked cancelled. Cancellation is per server process.
- **Delete** refuses `running` (cancel first) and `publishing`/`published` runs with `409`; published results are kept for audit. Response `data`: `{ id, semesterId, status, removedAssignments }`.
- **Verify** re-runs the algorithm from the run's stored snapshot (baseline also uses the stored seed and ratios) and compares who got which course, rank and phase. Response `data`: `{ runId, allMatch, results: [{ algorithm, matches, storedCount, replayedCount, onlyInStored, onlyInReplay, storedVersion, currentVersion, sameVersion, seed, note }] }`. `matches: null` means it could not be replayed (for example a baseline run without a stored seed). A mismatch can mean the stored data changed, or the algorithm version differs (`sameVersion: false`). Replay uses the same worker and time limit as a normal run (`504` on timeout).
- **Merit iteration:** baseline assignments now store `iteration` (1 or 2) for merit rows; it is `null` for random-phase and optimizer rows. It appears in `/results`, `by-student` and `by-course`.
- A run can now also have status `cancelled` (filter with `?status=cancelled`).

### POST /allocations/runs/:runId/publish

Body `{ "algorithm": "baseline" | "optimized" }` (required). The stored assignments are re-validated first (`422 PUBLICATION_VALIDATION_FAILED` on failure). Repeating the same algorithm returns `200` with no changes; a different algorithm on a published run returns `409`. Publishing an algorithm the run does not contain returns `400`.

### Allocation error codes

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | bad body or query |
| `ALLOCATION_FAILED` | 500 | algorithm error; run recorded as `failed` |
| `ALLOCATION_OUT_OF_MEMORY` | 500 | the run exceeded the worker memory cap; recorded as `failed` |
| `ALLOCATION_TIMEOUT` | 504 | exceeded `ALLOCATION_TIMEOUT_MS` (default 60 s); run recorded as `failed`, no assignments stored |
| `PREFERENCES_CLOSED` | 403 | preference edit outside the open window |
| `ALLOCATION_CANCELLED` | 409 | the run was cancelled by an admin while running |
| `REPLAY_FAILED` | 500 | the replay could not be completed |
| `PASSWORD_CHANGE_REQUIRED` | 403 | temporary password must be changed first |
| `INVALID_CURRENT_PASSWORD` | 400 | wrong current password on change-password |
| `IMPORT_VALIDATION_FAILED` | 422 | CSV rows have problems; nothing imported (`details` lists them) |
| `IMPORT_FAILED` | 500 | import failed part-way; created records were removed |
| `PERSISTENCE_FAILED` | 500 | storing results failed; run marked `failed`, nothing left behind |
| `PUBLICATION_VALIDATION_FAILED` | 422 | stored assignments failed re-validation |
| `PUBLISH_FAILED` | 500 | publish rolled back to `completed` |

## Runtime protections

- **Time limit:** `ALLOCATION_TIMEOUT_MS` (default 60000). A run over the limit is stopped and recorded as `failed` (`504 ALLOCATION_TIMEOUT`).
- **Memory cap:** each run executes in a worker thread limited to `ALLOCATION_WORKER_MAX_MB` (default 1024). A run that exceeds it is stopped and recorded as `failed` (`500 ALLOCATION_OUT_OF_MEMORY`) and the API process is unaffected.
- **Stuck runs:** a run left in `running` by a crash or restart is marked `failed` automatically (and its partial assignments removed) once it is older than twice the time limit plus a minute. The check runs at startup and every 5 minutes. A running run can also be cancelled manually.
- **Shutdown:** running workers are stopped on SIGINT/SIGTERM.
- **Large-run advisory:** a run that includes the optimizer with timetable checking on and 150 or more students gets a warning in `inputWarnings.messages` (the optimizer's timetable search can be very slow on large inputs). It never blocks the run.

## Known limits

- The optimizer's timetable conflict search can take from about 1 second to over a minute on medium datasets; use `includeTimetable: false` for larger data.
- Official institutional allocation rules are unconfirmed (see `docs/allocation-rules.md`).
