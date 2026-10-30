# Course Registration Optimization — Backend

**Node.js + Express + MongoDB API for the IIT (ISM) Dhanbad Course Registration Optimization System**

> This is a B.Tech final-year project prototype. It is not an official college registration system. Institutional allocation rules have not been formally confirmed; see [Allocation Policy Assumptions](#allocation-policy-assumptions).

**Related documents:** [`docs/api-contract.md`](../docs/api-contract.md) (every endpoint, request and response), [`docs/algorithm-design.md`](../docs/algorithm-design.md) (what the algorithms do and their limits), [`docs/problem-statement.md`](../docs/problem-statement.md), and the Postman collection [`postman/course-registration-api.json`](postman/course-registration-api.json).

---

## Prerequisites

| Requirement       | Version  |
|-------------------|----------|
| Node.js           | ≥ 20.0.0 |
| npm               | ≥ 10.x   |
| MongoDB Atlas     | Free tier or above |

---

## Installation

```bash
# From the repository root
cd backend
npm install
```

---

## Environment Setup

```bash
# 1. Copy the example file
cp .env.example .env

# 2. Open .env and fill in your values — see the table below
```

| Variable                    | Required | Description                                              |
|-----------------------------|----------|----------------------------------------------------------|
| `MONGODB_URI`               | ✅        | MongoDB Atlas connection string                          |
| `JWT_SECRET`                | ✅        | Long random string for JWT signing                       |
| `PORT`                      | no       | HTTP port (default: 5000)                                |
| `NODE_ENV`                  | no       | `development`, `test`, or `production` (default: development) |
| `CLIENT_ORIGIN`             | no       | Frontend URL for CORS (default: http://localhost:5173)   |
| `JWT_EXPIRES_IN`            | no       | JWT lifetime (default: 15m)                              |
| `RATE_LIMIT_LOGIN_MAX`      | no       | Max login attempts per window (default: 10)              |
| `RATE_LIMIT_LOGIN_WINDOW_MS`| no       | Rate-limit window in ms (default: 900000 = 15 min)       |
| `RATE_LIMIT_API_MAX`        | no       | Max API requests per IP per window (default: 300)        |
| `RATE_LIMIT_API_WINDOW_MS`  | no       | API rate-limit window in ms (default: 60000)             |
| `TRUST_PROXY`               | no       | Number of reverse proxies in front of the app (default: 0) |
| `ALLOCATION_TIMEOUT_MS`     | no       | Time limit for one allocation run (default: 60000)       |
| `ALLOCATION_WORKER_MAX_MB`  | no       | Memory cap for one run's worker thread (default: 1024)   |
| `SEED_STUDENT_PASSWORD`     | no       | Password for logins created by the seed script (random if unset) |
| `SEED_ADMIN_EMAIL`          | no       | Development-only first admin email                       |
| `SEED_ADMIN_PASSWORD`       | no       | Development-only first admin password                    |

> **Security:** Never commit `.env`. The root `.gitignore` already excludes it.
>
> **Database name:** put the database name in `MONGODB_URI` after the host (`...mongodb.net/course-registration?retryWrites=true&w=majority`). Without one, MongoDB uses its default database called `test`.

---

## MongoDB Atlas Configuration

1. Create a free cluster at [cloud.mongodb.com](https://cloud.mongodb.com).
2. Create a database user with read/write access.
3. Whitelist your IP address (or `0.0.0.0/0` for development).
4. Copy the connection string (SRV format) into `MONGODB_URI`.
5. The application creates its own collections and indexes on first run.

---

## Local Development

```bash
# Start with hot-reload (Node.js --watch)
npm run dev

# Start production mode
npm start

# API documentation (development only)
open http://localhost:5000/api-docs
```

---

## API Endpoints

All endpoints return a consistent JSON envelope:

**Success:**
```json
{ "success": true, "message": "...", "data": { ... } }
```

**Failure:**
```json
{ "success": false, "error": { "code": "...", "message": "...", "details": [] } }
```

### Health

| Method | Path      | Auth | Description          |
|--------|-----------|------|----------------------|
| GET    | `/health` | —    | App and DB status    |

### Authentication

| Method | Path                | Auth    | Description              |
|--------|---------------------|---------|--------------------------|
| POST   | `/api/v1/auth/login`  | —       | Login (sets cookie)      |
| POST   | `/api/v1/auth/logout` | —       | Logout (clears cookie)   |
| GET    | `/api/v1/auth/me`     | 🔒 any  | Current user info        |
| POST   | `/api/v1/auth/change-password` | 🔒 any | Change own password (also the only action allowed with a temporary password) |

### Students

| Method | Path                    | Auth               | Description                                     |
|--------|-------------------------|--------------------|-------------------------------------------------|
| GET    | `/api/v1/students`      | 🔒 admin/faculty   | List with pagination (students cannot enumerate all records) |
| GET    | `/api/v1/students/:id`  | 🔒 any             | Own record (student); any record (admin/faculty) |
| POST   | `/api/v1/students`      | 🔒 admin/faculty   | Create student                                  |
| PATCH  | `/api/v1/students/:id`  | 🔒 admin/faculty   | Update student (allowlisted fields only)         |
| DELETE | `/api/v1/students/:id`  | 🔒 admin           | Deactivate (soft)                               |

> **Ownership rule:** A student calling `GET /api/v1/students/:id` may only retrieve their own linked Student document. Attempting to fetch another student's record returns `403 Forbidden`.

### Courses

| Method | Path                   | Auth               | Description          |
|--------|------------------------|--------------------|----------------------|
| GET    | `/api/v1/courses`      | 🔒 any             | List with pagination |
| GET    | `/api/v1/courses/:id`  | 🔒 any             | Get by MongoDB ID    |
| POST   | `/api/v1/courses`      | 🔒 admin/faculty   | Create course        |
| PATCH  | `/api/v1/courses/:id`  | 🔒 admin/faculty   | Update course        |
| DELETE | `/api/v1/courses/:id`  | 🔒 admin           | Deactivate (soft)    |

### Preferences

| Method | Path                       | Auth               | Description                    |
|--------|----------------------------|--------------------|--------------------------------|
| GET    | `/api/v1/preferences/me`   | 🔒 student (linked record required) | Student's own preferences. Admin/faculty get `403`; a student account without a valid linked student record gets `400`. No query runs without a valid student id. |
| PUT    | `/api/v1/preferences/me`   | 🔒 student         | Submit/update preferences       |
| GET    | `/api/v1/preferences`      | 🔒 admin/faculty   | All preferences (paginated)     |
| GET    | `/api/v1/preferences/:id`  | 🔒 admin/faculty   | Single preference document      |

### Users

| Method | Path            | Auth     | Description |
|--------|-----------------|----------|-------------|
| POST   | `/api/v1/users` | 🔒 admin | Create a login. `role: "student"` requires `studentId` (the login is bound to that Student record; one login per student). No public signup. The password hash is never returned. |
| GET    | `/api/v1/users`, `/api/v1/users/:id` | 🔒 admin | List (filter by role/active/email) or fetch logins |
| PATCH  | `/api/v1/users/:id/status` | 🔒 admin | Activate / deactivate (not yourself, not the last active admin) |
| POST   | `/api/v1/users/:id/reset-password` | 🔒 admin | New one-time temporary password, forced change |
| POST   | `/api/v1/imports/students`, `/courses`, `/preferences` | 🔒 admin | CSV bulk import (`dryRun`, `onExisting`, `createLogins`); see `docs/api-contract.md` |

### Semesters

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET    | `/api/v1/semesters/:semesterId/status` | 🔒 any | Banner status (`me` for students). One of `preferences-not-open`, `preferences-open`, `allocation-pending`, `results-published` |
| GET    | `/api/v1/semesters` | 🔒 admin/faculty | List semester records |
| POST   | `/api/v1/semesters` | 🔒 admin | Create with optional `preferencesOpenAt` / `preferencesCloseAt` |
| PATCH  | `/api/v1/semesters/:semesterId` | 🔒 admin | Update name/dates |
| PUT    | `/api/v1/semesters/:semesterId/preferences-state` | 🔒 admin | `open` / `closed` / `auto` override |

> A semester with no record is treated as open. Preference edits outside the window return `403 PREFERENCES_CLOSED`; publishing a run closes preferences automatically.

### Allocations

| Method | Path                                       | Auth   | Description                          |
|--------|--------------------------------------------|--------|--------------------------------------|
| GET    | `/api/v1/allocations/my-results`           | 🔒 student | Own PUBLISHED assignments only |
| GET    | `/api/v1/allocations/published`            | 🔒 any | Published run info for a semester (`?semesterId=`; students: own semester) |
| POST   | `/api/v1/allocations/compare`              | 🔒 admin | Run BOTH algorithms together in one run |
| POST   | `/api/v1/allocations/run`                  | 🔒 admin | Run ONE selected algorithm (`baseline` or `optimized`) as its own run |
| GET    | `/api/v1/allocations/runs/compare`         | 🔒 admin/faculty | Side-by-side comparison of two stored runs |
| GET    | `/api/v1/allocations/runs`                 | 🔒 admin/faculty | List runs (paginated)        |
| GET    | `/api/v1/allocations/runs/:runId`          | 🔒 admin/faculty | Run summary + metrics        |
| GET    | `/api/v1/allocations/runs/:runId/results`  | 🔒 admin/faculty | Assignments (paginated; filters `phase`, `rank`, `courseCode`, `studentId`; `sort`) |
| GET    | `/api/v1/allocations/runs/:runId/export`   | 🔒 admin/faculty | CSV download of one algorithm's assignments (formula-injection safe) |
| POST   | `/api/v1/allocations/runs/:runId/cancel`   | 🔒 admin | Cancel a running run (stops its worker) |
| DELETE | `/api/v1/allocations/runs/:runId`          | 🔒 admin | Delete a never-published run and its assignments |
| POST   | `/api/v1/allocations/runs/:runId/verify`   | 🔒 admin | Replay check against the stored snapshot, seed and ratios |
| GET    | `/api/v1/allocations/runs/:runId/summary`  | 🔒 admin/faculty | Both algorithms side by side + differences, one call |
| GET    | `/api/v1/allocations/runs/:runId/results/by-student` | 🔒 admin/faculty | One row per student (incl. unallocated), search/sort/paginate |
| GET    | `/api/v1/allocations/runs/:runId/results/by-course`  | 🔒 admin/faculty | One row per course: seats, utilization, demand |
| POST   | `/api/v1/allocations/runs/:runId/publish`  | 🔒 admin | Publish selected algorithm's results |

> **Publish body (required):**
> ```json
> { "algorithm": "optimized" }
> ```
> Accepted values: `"optimized"` or `"baseline"`. Only the selected algorithm's assignment records are published; the other remains available for comparison and audit. Once a run is published with one algorithm, switching to the other returns `409 Conflict`.
>
> **Running one algorithm independently:** `POST /allocations/run` with `{ "semesterId": "...", "algorithm": "baseline" | "optimized", "maxCoursesPerStudent": 2, "includeTimetable": true }`. `meritRatio`, `randomRatio` and `seed` are accepted for `baseline` only (ratios must sum to 1) and rejected for `optimized`. The run stores only that algorithm's assignments, metrics, validation and runtime (`algorithmsRun: ["baseline"]`), plus an `inputFingerprint` (SHA-256 of the normalized input). It is validated, persisted and publishable exactly like a combined run; publishing an algorithm the run does not contain returns `400`.
>
> **Comparing runs manually:** `GET /allocations/runs/compare?runA=<id>&runB=<id>[&algorithmA=...&algorithmB=...]`. A single-algorithm run is resolved automatically; a run that holds both needs `algorithmA`/`algorithmB`. The response gives each side's metrics, configuration, seed, runtime and validation, the difference (B minus A) for each metric, `sameInput`, and `warnings` when the runs used different input data, semesters, `maxCoursesPerStudent` or timetable settings. No winner is declared: the baseline keeps merit/random quotas while the optimizer ignores quotas and CGPA. `GET /runs?algorithm=` filters runs by contained algorithm. Runs created before this feature are treated as containing both algorithms.
>
> `POST /compare` also accepts an optional integer `seed` (0-4294967295) for the baseline lottery; when omitted a seed is generated. The seed, `algorithmVersion` and full normalized snapshot are stored on the run.

---

## Authentication Behavior

- Login sets a short-lived **HTTP-only** cookie named `token`.
- JWTs expire in 15 minutes (configurable via `JWT_EXPIRES_IN`).
- Cookies use `sameSite: strict` in production, `lax` in development.
- Cookies use `secure: true` in production (HTTPS required).
- The login endpoint is rate-limited (default: 10 attempts per 15 minutes, in-memory).
- Roles: `student`, `faculty`, `admin`. Role is taken from the database only — never from client input.

### Passwords and the first admin (production)

```bash
node scripts/create-admin.js --email admin@college.edu          # generated one-time password, printed once
node scripts/create-admin.js --email admin@college.edu --reset  # recover an existing admin
```
Temporary passwords (new logins without a password, admin resets, student CSV imports with `createLogins=true`, `create-admin`) are generated by the server, shown once, stored only as a hash, and must be changed at first login (`403 PASSWORD_CHANGE_REQUIRED` until then). A password change or reset invalidates all older tokens. There is no email service: the admin passes the password on.

### Creating the First Admin (Development Only)

Set `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in `.env`. The server seeds this account once on startup in `NODE_ENV=development`. Remove these variables before deploying.

---

## Database Model Overview

| Collection      | Purpose                                              |
|-----------------|------------------------------------------------------|
| `users`         | Authentication records (email, hash, role, must-change-password flag) |
| `semesters`     | Per-semester preference window (open/close dates, manual override) |
| `students`      | Student profiles (studentId, name, cgpa, semesterId) |
| `courses`       | Course records (courseCode, capacity, timetable)     |
| `preferences`   | Ranked preference lists per student/semester/group   |
| `allocationruns`| Run metadata, configuration, metrics, audit trail    |
| `allocations`   | Per-assignment records linked to a run               |

---

## Algorithm Integration

The backend calls the **existing algorithm module** at `../algorithm/src/services/allocationComparisonService.js`.

**Import path (real, not mocked):**
```js
import { runAllocationComparison } from '../algorithm/src/services/allocationComparisonService.js';
```

**Normalization pipeline** (`src/services/allocationEngine.service.js`):

```
Mongoose Docs → normalizeStudents → { id, name, cgpa }
Mongoose Docs → normalizeCourses  → { id, name, capacity }
Preference Docs → normalizePreferences → { studentId, courseId, rank }
Course Docs → buildTimetableMap  → { [courseCode]: [{ day, start, end }] }
```

The algorithm is invoked **outside** any MongoDB transaction so long-running computation does not hold a DB lock.

---

## Allocation Policy Assumptions

> **Important:** The official IIT (ISM) Dhanbad allocation rules have not been confirmed. The following documents the current algorithm's actual behavior:

- The **baseline** uses a merit phase (top 75% of capacity) followed by a random phase (25%).
- The **optimized** algorithm uses Min-Cost Max-Flow to maximize the number of assignments and then minimize preference-rank cost.
- Neither algorithm enforces **strict CGPA priority** (i.e., a lower-CGPA student could receive a course over a higher-CGPA student if it improves global assignment count).
- Elective-group quotas are not enforced per group — all preferences across groups are pooled.
- Published results must have zero constraint violations.
- **`meritRatio + randomRatio` must equal exactly 1.0** (within floating-point tolerance ±1×10⁻⁹). The `POST /compare` endpoint returns `400` if they do not sum to 1.
- **Student eligibility for elective groups:** If a student's `electiveGroups` array is empty, preferences for any group are accepted (assumption — official rule not documented in `docs/allocation-rules.md`).
- **Input snapshot:** Each `AllocationRun` stores a full normalized snapshot of students, courses, preferences, and timetable data used during the run. This enables reproducible auditing independent of subsequent data changes.
- `meritRatio: 0` (all seats by lottery) and `randomRatio: 0` (all seats by merit) are valid. Both must be finite, in `[0, 1]`, and sum to 1; this is enforced by the API (Zod) and again by the algorithm. Each phase's per-course quota is `floor(capacity * ratio)`, so a seat can be lost to rounding for ratios like 0.75/0.25 on small capacities (existing behavior, unchanged).
- See `docs/allocation-rules.md` for open questions that must be answered before institutional deployment.

---

## Publication, Validation and Reproducibility

**Run persistence** (works on a standalone MongoDB, no transactions): the run is created `running`, the algorithm executes with no transaction/lock open, its output is validated (unknown student/course, duplicates, invalid rank, metrics that disagree with the assignment count are *rejected, never silently dropped*), assignments are inserted and counted, and only then does a conditional update mark the run `completed`. Any failure deletes the run's assignments and marks it `failed` with a truncated `errorSummary`.

**Publication-state policy:** `completed -> publishing -> published`.
1. Before publishing, the **actual stored assignments** of the selected algorithm are re-validated against the run's immutable snapshot (the algorithm's shared `validateAllocation`, identical for baseline and optimized) plus reference integrity, semester match, elective-group and rank consistency, non-empty result, and stale-metric detection. The outcome is stored in `publicationCheck`. Failure returns `422 PUBLICATION_VALIDATION_FAILED` with up to 10 error details.
2. The claim `completed -> publishing` is a single conditional `findOneAndUpdate`, atomic per document (also on a standalone server). Exactly one concurrent request wins; losers get `409` and write nothing.
3. Only the selected algorithm's assignments are marked `published`; then the run becomes `published`. Any failure rolls back to `completed` / `proposed` (`500 PUBLISH_FAILED`).
4. Repeating the same algorithm on a published run returns `200` without writes (idempotent). A different algorithm returns `409`; create a new run instead.
5. **Crash recovery:** a process crash between steps 2 and 3 leaves the run in `publishing`. Publishes get `409` while the claim is younger than 5 minutes; after that the next publish request rolls the stale claim back (one winner, conditional update) and proceeds.

**Not enforced because no institutional rule is documented** (`docs/allocation-rules.md` is unfilled): compulsory/required courses, required electives per group, per-group quotas, maximum preferences per group, prerequisites, reserved seats, strict CGPA priority, eligibility by department/programme/academic year. An empty (zero-assignment) result is rejected since a valid zero-allocation publication is not defined.

**Preference submission** derives identity only from the authenticated account and checks: active student, the student's own `semesterId` equals the requested semester (fails closed if unset), elective-group membership (existing rule: an empty `electiveGroups` list allows any group), every course exists, is active, is in the requested semester **and** group, no duplicate courses. Rank is the array position, so ranks are contiguous by construction.

**Elective groups:** `electiveGroup` is carried on every normalized course and preference record and stored in the snapshot; publication checks that each assignment's course group matches the group it was selected under. The optimizers themselves are still group-agnostic (see limitations).

**Timetable rules** (weekday, `HH:MM` with hour 00-23 / minute 00-59, start strictly before end) live in `src/utils/timetable.js` and are enforced by both the Zod schemas and the `Course` model (create and `runValidators` updates). A dotted-path update of a single slot field cannot check start < end at the model level; the course update API only replaces the whole `timetableSlots` array.

**Reproducibility:** the stored snapshot (students, courses, preferences, timetable, configuration), `algorithmVersion` and `randomSeed` allow the baseline to be re-run identically with the same algorithm code (`mulberry32` PRNG, fully determined by the seed). The optimized (MCMF) result is deterministic. Limits: reproduction requires the same `algorithmVersion` code; no replay endpoint exists yet (re-run `runAllocationComparison` with the snapshot and `seed`); snapshots contain student CGPAs and are only returned by the admin/faculty `GET /runs/:runId` (list responses omit them).

---

## Configuration notes

- Cookie lifetime follows `JWT_EXPIRES_IN` (there is no refresh-token flow; sessions end when the token expires).
- `JWT_SECRET` must be at least 32 characters when `NODE_ENV=production` (the server refuses to start otherwise).
- A general limiter applies to `/api/*` (`RATE_LIMIT_API_MAX` per `RATE_LIMIT_API_WINDOW_MS`, default 300/min per IP) in addition to the stricter login limiter. Set `TRUST_PROXY` to the number of reverse proxies in front of the app, otherwise all clients appear to share the proxy's IP.
- Validation uses zod 4. Defaults (`.default()`) are applied on create only; PATCH schemas never inject defaults, because zod 4 would otherwise reset omitted fields.

## Mock Data and Experiments (seed script)

Real student data is not available, so experiments use deterministic generated data. The same `--scenario/--size/--seed` always regenerates the same dataset.

```bash
# from backend/ (needs MONGODB_URI and JWT_SECRET in .env; refuses NODE_ENV=production)
npm run seed -- --scenario balanced --size small --semester SEM-SEED --seed 1 --reset --users
```

> **Windows PowerShell:** PowerShell swallows the `--` that `npm run seed --` relies on, so the flags are silently dropped (the script then runs with defaults and no `--reset`/`--users`). Call the script directly instead: `node scripts/seed.js --scenario balanced --size small --reset --users`.

| Option | Values | Meaning |
|---|---|---|
| `--scenario` | `balanced`, `scarce-seats`, `many-ties`, `many-clashes` | seats about 1.2x / 0.6x students per group; only four distinct CGPAs; twelve shared time slots |
| `--size` | `small` (30), `medium` (200), `large` (1000) or an integer | number of students |
| `--semester` | any id (default `SEM-SEED`) | semester the data is created under |
| `--seed` | integer | regenerates identical data |
| `--reset` | flag | first delete earlier seeded data of that semester (only records with the `SEED` / `SD-` prefix) |
| `--users` | flag | also create `seedNNNN@seed.local` student logins; the password comes from `SEED_STUDENT_PASSWORD` or is generated and printed once |

Generated data: two elective groups (A, B), 3-10 courses per group, each student ranks up to 15 courses per group (skewed so some courses are popular), every list `submitted`. Then run `POST /allocations/run` once per algorithm and `GET /allocations/runs/compare`. Group sizes, capacities and clash rates are **test assumptions, not institutional rules**.

### Runtime protections and tracing

- Every response has an `X-Request-Id` header and error bodies carry `requestId`; the same id is in the server logs.
- `GET /health` also reports the algorithm package, its version, uptime and the number of runs computing right now.
- A run's worker thread has a memory cap (`ALLOCATION_WORKER_MAX_MB`, default 1024) in addition to the time limit; exceeding it fails only that run (`ALLOCATION_OUT_OF_MEMORY`).
- Runs left in `running` by a crash or restart are marked failed automatically after twice the time limit plus a minute (checked at startup and every 5 minutes); workers are stopped at shutdown.
- A run that includes the optimizer with the timetable check on and 150+ students records an advisory in `inputWarnings` (the optimizer's timetable search can be very slow on large inputs).

### Stale records, time limit and optimizer scaling

- **Stale data no longer crashes a run.** Preferences are loaded for the whole semester, but only active students and active courses take part. Preference lists of inactive students are skipped, withdrawn courses are dropped (the remaining courses keep their order), and everything excluded is recorded on the run as `inputWarnings`. A partly filled-in timetable (some active courses without slots) is rejected with `400` before a run is created; disable it with `includeTimetable: false`.
- **Runs execute in a worker thread with a time limit** (`ALLOCATION_TIMEOUT_MS`, default 60000). A run that exceeds it is stopped, recorded as `failed`, leaves no assignments, and answers `504 ALLOCATION_TIMEOUT`; other API requests are not blocked meanwhile.
- **Measured optimizer behavior (this machine; 200-student datasets).** The baseline takes under 100 ms up to 1000 students. The optimizer's flow solver is fast (about 15-35 ms at 200 students, 330-445 ms at 1000, without a timetable), but its timetable conflict search is **highly data-dependent**, from about a second to more than a minute for the same size: with data seed 5 `balanced` did not finish in 40 s while `many-ties` took 13 s; with data seed 1 `balanced` took 46 s while `many-ties` exceeded the 60 s limit (the run was stopped with `504` and left no assignments). A 30-student run with only eight shared slots took 17 s. For medium and larger datasets run the optimizer with `includeTimetable: false` (or accept a possible `504`). Note that a comparison between a timetable-checked baseline and an unchecked optimizer is not like-for-like; the compare endpoint warns when `timetableValidationEnabled` differs. The algorithm itself is unchanged; improving this is future algorithm work.

---

## Testing

```bash
# Backend unit + HTTP tests (no database, no secrets needed)
npm test

# Watch mode
npm run test:watch

# Algorithm tests (the algorithm package has its own dependencies)
cd ../algorithm && npm ci && npm test
```

Current results: **backend 29 test files, 575 tests; algorithm 14 test files, 95 tests**, all passing. They run without a `.env` file, and the same two suites run in CI (`.github/workflows/ci.yml`, Node 20 and 22) on every push and pull request to `main`.

### Real-database end-to-end check (manual)

The unit and HTTP tests use mocked models. A separate script exercises the whole system against a **real MongoDB (Atlas)**: seeding, login and roles, CSV imports, both algorithms, publishing and a concurrent-publish race, replay verification, cancelling a long run, temporary passwords, deadlines, the dashboard views and more (132 checks at the time of writing).

```bash
node tests/e2e/realdb.e2e.mjs
```

It needs `MONGODB_URI` and `JWT_SECRET` in `.env` (and your IP allowed in Atlas Network Access). It never touches your data: it switches to a throwaway database named `course_reg_e2e_<timestamp>` and drops it at the end. The server logs are noisy; to see only the checks, filter the output for lines starting with `PASS`, `FAIL` or `SKIP`, and the final `N/N checks passed` line. It is not run in CI because it needs database credentials.

---

## Known Limitations

1. **Rate limiting is in-memory.** Not shared across Node.js instances. For multi-instance deployments, use a shared store.
2. **Algorithm policy not confirmed.** The optimizer does not reproduce the official IIT (ISM) allocation procedure.
3. **No institutional SSO.** Authentication is local password-based. Institutional integration would require replacing the auth provider.
4. **Deadlines are per semester only.** Preference windows are enforced (see Semesters), but there is no per-student or per-group deadline.
5. **No real-time notifications.** Allocation run status is only available via polling.
6. **Concurrency is tested against a fake in the unit tests and against real Atlas in the manual end-to-end script.** Publication safety relies on MongoDB's per-document atomic `findOneAndUpdate`; six simultaneous publishes of one run produced exactly one publication on Atlas. It has not been load-tested.
7. **Optimizer is group-agnostic and not CGPA-priority based**, and compulsory-course / per-group rules are undefined; the system must not be presented as the official allotment procedure until policy is confirmed.
8. **Crash recovery window.** A run abandoned mid-publication is blocked for 5 minutes (`PUBLISH_STALE_MS`) before it can be recovered automatically.
9. **Student fields.** Faculty can create students and edit name/department, but only admins may change `cgpa`, `semesterId`, `electiveGroups` and `isActive` on update (faculty creation still sets an initial CGPA).
10. **No self-service password reset.** Admins can create logins, list and deactivate them, and issue temporary passwords, and users can change their own password, but there is no "forgot password" email flow (no mail service). The first production admin is created with `node scripts/create-admin.js`.
11. **Optimizer speed with timetable checking.** Its clash search is data dependent and can take from milliseconds to over a minute at 200 students (see `docs/algorithm-design.md`). Runs have a time limit and a memory cap, large runs get a warning, and `includeTimetable=false` avoids the search. Speeding it up is an algorithm change that is still to be decided.
12. **Run cancellation is per server process.** Cancelling stops a run only on the instance that is computing it; a stale `running` run left by a crash is cleaned up automatically.
13. **Dev-tooling advisories.** `npm audit --omit=dev` reports 0 vulnerabilities; remaining advisories are in vitest/vite/esbuild test tooling (major-version upgrade not done).

