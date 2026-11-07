/**
 * src/services/runViews.service.js
 * Read-only views of a stored allocation run for the admin/faculty dashboard:
 *   - getRunSummary:       both algorithms side by side (one call)
 *   - getResultsByStudent: one row per student (including unallocated ones)
 *   - getResultsByCourse:  one row per course (seats, utilization, demand)
 *
 * These views contain CGPA and per-student data, so the routes are limited to
 * admin/faculty. The student and course universe comes from the run's stored
 * input snapshot, so later edits to live documents cannot change a stored run.
 */

import mongoose from "mongoose";
import AllocationRun from "../models/AllocationRun.js";
import Allocation from "../models/Allocation.js";
import { ApiError } from "../utils/ApiError.js";
import { csvCell } from "../utils/csv.js";

export { csvCell };

const VIEWABLE_STATUSES = ["completed", "publishing", "published"];

const COMPARED_METRICS = [
  "totalAssignments",
  "studentsWithAtLeastOneCourse",
  "studentsWithTwoCourses",
  "unallocatedStudents",
  "capacityUtilization",
  "rank1Assignments",
  "rank2Assignments",
  "averagePreferenceRank",
  "constraintViolations",
  "timetableClashes",
  "studentsMissingAGroup",
  "groupLimitViolations",
  "cgpaPriorityViolations",
];

const POLICY_NOTE =
  "difference = optimized minus baseline. Lower is better for averagePreferenceRank, unallocatedStudents and " +
  "constraintViolations; higher is usually better for assignments. No winner is declared because the algorithms " +
  "follow different policies (the baseline keeps merit/random quotas; the optimizer maximizes assignments). " +
  "When the optimizer was held to the baseline's result, no student ends worse than under the baseline and CGPA " +
  "decides who gets the better choices among equal results; see the per-student comparison.";

export function containedAlgorithms(run) {
  return run.algorithmsRun?.length ? run.algorithmsRun : ["baseline", "optimized"];
}

export async function loadRun(runId, projection) {
  if (!mongoose.isValidObjectId(runId)) throw ApiError.notFound("Allocation run");
  const query = AllocationRun.findById(runId);
  if (projection) query.select(projection);
  const run = await query.lean();
  if (!run) throw ApiError.notFound("Allocation run");
  return run;
}

export function assertViewable(run) {
  if (!VIEWABLE_STATUSES.includes(run.status)) {
    throw ApiError.badRequest(`This run has no viewable results (status: "${run.status}").`);
  }
}

/** Which algorithm's rows to show: explicit, else the published one, else the only one. */
export function resolveAlgorithm(run, requested) {
  const contained = containedAlgorithms(run);
  if (requested) {
    if (!contained.includes(requested)) {
      throw ApiError.badRequest(`This run has no "${requested}" results.`);
    }
    return requested;
  }
  if (run.selectedAlgorithm && contained.includes(run.selectedAlgorithm)) return run.selectedAlgorithm;
  if (contained.length === 1) return contained[0];
  throw ApiError.badRequest('This run contains both algorithms; pass algorithm=baseline or algorithm=optimized.');
}

function sideOf(run, algorithm) {
  const isOpt = algorithm === "optimized";
  const validation = isOpt ? run.optimizedValidation : run.baselineValidation;
  return {
    algorithm,
    metrics: (isOpt ? run.optimizedMetrics : run.baselineMetrics) ?? null,
    runtimeMs: (isOpt ? run.optimizedRuntimeMs : run.baselineRuntimeMs) ?? null,
    validation: validation
      ? { valid: validation.valid, errorCount: validation.errorCount, errorList: validation.errorList ?? [] }
      : null,
    details: run.algorithmDetails?.[algorithm] ?? null,
    published: run.selectedAlgorithm === algorithm && run.status === "published",
  };
}

function paginate(items, page, limit) {
  const total = items.length;
  const start = (page - 1) * limit;
  return { items: items.slice(start, start + limit), total, page, limit, totalPages: Math.ceil(total / limit) };
}

const text = (v) => String(v ?? "").toLowerCase();

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/**
 * How the optimizer's result compares with the baseline, student by student and group by group,
 * so "better than the baseline" is shown, not claimed. Only totals and averages are returned
 * (no individual CGPAs). Returns null if anything needed is missing.
 */
export async function comparisonEvidence(run) {
  try {
    const [rows, withStudents] = await Promise.all([
      Allocation.find({ run: run._id }).select("algorithm preferenceRank electiveGroup student").populate("student", "studentId").lean(),
      AllocationRun.findById(run._id).select("inputSnapshot.students").lean(),
    ]);
    const students = withStudents?.inputSnapshot?.students ?? [];
    if (!rows.length || !students.length) return null;

    const cgpa = new Map(students.map((s) => [s.id, s.cgpa]));
    const slotsOf = (algorithm) => {
      const slots = new Map();
      const perStudent = new Map();
      for (const a of rows.filter((r) => r.algorithm === algorithm)) {
        const id = a.student?.studentId;
        if (!id) continue;
        slots.set(`${id}|${a.electiveGroup ?? ""}`, a.preferenceRank);
        if (!perStudent.has(id)) perStudent.set(id, []);
        perStudent.get(id).push(a.preferenceRank);
      }
      return { slots, perStudent };
    };
    const base = slotsOf("baseline");
    const opt = slotsOf("optimized");

    let better = 0, same = 0, worse = 0, gained = 0;
    for (const [slot, rank] of base.slots) {
      const x = opt.slots.get(slot);
      if (x === undefined || x > rank) worse++;
      else if (x < rank) better++;
      else same++;
    }
    for (const slot of opt.slots.keys()) if (!base.slots.has(slot)) gained++;

    const topCount = Math.max(1, Math.ceil(students.length / 5));
    const top = new Set([...students].sort((a, b) => b.cgpa - a.cgpa || String(a.id).localeCompare(String(b.id))).slice(0, topCount).map((s) => s.id));
    const average = (side, pick) => {
      const ranks = [...side.perStudent].filter(([id]) => pick(id)).flatMap(([, r]) => r);
      return ranks.length ? Number((ranks.reduce((a, b) => a + b, 0) / ranks.length).toFixed(2)) : null;
    };
    const worst = (side) => Math.max(0, ...[...side.slots.values()]);

    return {
      slots: base.slots.size,
      better, same, worse, gained,
      topCgpa: { students: top.size, baselineAverageRank: average(base, (id) => top.has(id)), optimizedAverageRank: average(opt, (id) => top.has(id)) },
      others: { students: students.length - top.size, baselineAverageRank: average(base, (id) => !top.has(id)), optimizedAverageRank: average(opt, (id) => !top.has(id)) },
      worstRank: { baseline: worst(base), optimized: worst(opt) },
      cgpaPriorityViolations: {
        baseline: run.baselineMetrics?.cgpaPriorityViolations ?? null,
        optimized: run.optimizedMetrics?.cgpaPriorityViolations ?? null,
      },
      heldToBaseline: run.configuration?.optimizerFloor === "baseline",
    };
  } catch {
    return null;
  }
}

/**
 * Everything the comparison dashboard needs, in one call. Never returns the
 * (large) input snapshot, only its counts.
 */
export async function getRunSummary(runId) {
  const run = await loadRun(
    runId,
    "-inputSnapshot.students -inputSnapshot.courses -inputSnapshot.preferences -inputSnapshot.timetable -inputSnapshot.fixedTimetable"
  );

  const contained = containedAlgorithms(run);
  const algorithms = {
    baseline: contained.includes("baseline") ? sideOf(run, "baseline") : null,
    optimized: contained.includes("optimized") ? sideOf(run, "optimized") : null,
  };

  const both = Boolean(algorithms.baseline?.metrics && algorithms.optimized?.metrics);
  let difference = null;
  if (both) {
    difference = {};
    for (const key of COMPARED_METRICS) {
      const x = algorithms.baseline.metrics[key];
      const y = algorithms.optimized.metrics[key];
      difference[key] = typeof x === "number" && typeof y === "number" ? Number((y - x).toFixed(4)) : null;
    }
    const bt = algorithms.baseline.runtimeMs;
    const ot = algorithms.optimized.runtimeMs;
    difference.runtimeMs = typeof bt === "number" && typeof ot === "number" ? Number((ot - bt).toFixed(3)) : null;
  }

  const warnings = [];
  if (run.inputWarnings?.messages?.length) warnings.push(...run.inputWarnings.messages);
  if (both && algorithms.baseline && algorithms.optimized && run.configuration?.timetableValidationEnabled === false) {
    warnings.push("Timetable validation was off for this run, so timetable clashes were not checked.");
  }

  return {
    run: {
      id: run._id,
      semesterId: run.semesterId,
      status: run.status,
      errorSummary: run.errorSummary ?? null,
      algorithmsRun: contained,
      algorithmVersion: run.algorithmVersion ?? null,
      randomSeed: run.randomSeed ?? null,
      selectedAlgorithm: run.selectedAlgorithm ?? null,
      publishedAt: run.publishedAt ?? null,
      createdAt: run.createdAt,
      totalRuntimeMs: run.totalRuntimeMs ?? null,
      configuration: run.configuration,
      inputCounts: {
        students: run.inputSnapshot?.studentCount ?? null,
        courses: run.inputSnapshot?.courseCount ?? null,
        preferences: run.inputSnapshot?.preferenceCount ?? null,
        timetableIncluded: run.inputSnapshot?.timetableIncluded ?? null,
      },
      publicationCheck: run.publicationCheck ?? null,
    },
    algorithms,
    comparison: {
      available: both,
      difference,
      note: POLICY_NOTE,
      warnings,
      // student-by-student comparison with the baseline (null when it cannot be computed)
      evidence: both ? await comparisonEvidence(run) : null,
    },
  };
}

// ---------------------------------------------------------------------------
// By student
// ---------------------------------------------------------------------------

async function loadAssignments(run, algorithm) {
  return Allocation.find({ run: run._id, algorithm })
    .populate("student", "studentId name cgpa department")
    .populate("course", "courseCode title capacity electiveGroup")
    .lean();
}

/** One summary per student (courses sorted by rank, average rank, status) for one algorithm's rows. */
function summariseStudents(run, rows) {
  const byStudent = new Map();
  for (const s of run.inputSnapshot?.students ?? []) {
    byStudent.set(s.id, { studentId: s.id, name: s.name, cgpa: s.cgpa, courses: [] });
  }
  for (const a of rows) {
    const sid = a.student?.studentId;
    if (!sid) continue;
    if (!byStudent.has(sid)) {
      byStudent.set(sid, { studentId: sid, name: a.student.name, cgpa: a.student.cgpa, courses: [] });
    }
    byStudent.get(sid).courses.push({
      courseCode: a.course?.courseCode ?? null,
      title: a.course?.title ?? null,
      electiveGroup: a.electiveGroup ?? a.course?.electiveGroup ?? null,
      preferenceRank: a.preferenceRank,
      phase: a.phase ?? null,
      iteration: a.iteration ?? null,
    });
  }
  for (const s of byStudent.values()) {
    s.courses.sort((x, y) => (x.preferenceRank ?? 0) - (y.preferenceRank ?? 0));
    const ranks = s.courses.map((c) => c.preferenceRank).filter((r) => Number.isFinite(r));
    s.coursesAllocated = s.courses.length;
    s.averageRank = ranks.length ? Number((ranks.reduce((x, y) => x + y, 0) / ranks.length).toFixed(2)) : null;
    s.status = s.courses.length > 0 ? "allocated" : "unallocated";
  }
  return byStudent;
}

/**
 * One row per student: the courses they got (with preference rank and phase),
 * or none. Students who received nothing are included, using the run's stored
 * snapshot as the student list. When the run holds both algorithms, each row also
 * carries the other algorithm's result (`other`) and whether the two differ.
 */
export async function getResultsByStudent(runId, query = {}) {
  const { algorithm: requested, search, status = "all", sort = "studentId", page = 1, limit = 50 } = query;
  const run = await loadRun(runId);
  assertViewable(run);
  const algorithm = resolveAlgorithm(run, requested);

  const rows = await loadAssignments(run, algorithm);

  const byStudent = summariseStudents(run, rows);

  // With both algorithms in the run, set each student's result beside the other algorithm's.
  const otherAlgorithm = containedAlgorithms(run).find((x) => x !== algorithm) ?? null;
  let compare = { available: false, otherAlgorithm: null, differing: 0, total: byStudent.size };
  if (otherAlgorithm) {
    const other = summariseStudents(run, await loadAssignments(run, otherAlgorithm));
    let differing = 0;
    for (const [id, mine] of byStudent) {
      const theirs = other.get(id);
      const key = (c) => `${c.electiveGroup ?? ""}|${c.courseCode}`;
      const mineKeys = new Set(mine.courses.map(key));
      const theirKeys = new Set((theirs?.courses ?? []).map(key));
      const differs = mineKeys.size !== theirKeys.size || [...mineKeys].some((k) => !theirKeys.has(k));
      if (differs) differing += 1;
      mine.other = {
        algorithm: otherAlgorithm,
        courses: theirs?.courses ?? [],
        coursesAllocated: theirs?.coursesAllocated ?? 0,
        averageRank: theirs?.averageRank ?? null,
      };
      mine.differs = differs;
    }
    compare = { available: true, otherAlgorithm, differing, total: byStudent.size };
  }

  let list = [...byStudent.values()];

  if (status === "differs") list = list.filter((s) => s.differs === true);
  else if (status === "same") list = list.filter((s) => s.differs === false);
  else if (status !== "all") list = list.filter((s) => s.status === status);
  if (search) {
    const q = text(search);
    list = list.filter((s) => text(s.studentId).includes(q) || text(s.name).includes(q));
  }

  const sorters = {
    studentId: (a, b) => a.studentId.localeCompare(b.studentId),
    name: (a, b) => text(a.name).localeCompare(text(b.name)),
    cgpa: (a, b) => (b.cgpa ?? 0) - (a.cgpa ?? 0) || a.studentId.localeCompare(b.studentId),
    coursesAllocated: (a, b) => b.coursesAllocated - a.coursesAllocated || a.studentId.localeCompare(b.studentId),
    averageRank: (a, b) =>
      (a.averageRank ?? Infinity) - (b.averageRank ?? Infinity) || a.studentId.localeCompare(b.studentId),
  };
  list.sort(sorters[sort] ?? sorters.studentId);

  const { items, ...paging } = paginate(list, page, limit);
  return {
    runId: run._id,
    algorithm,
    snapshotAvailable: Boolean(run.inputSnapshot?.students?.length),
    compare,
    students: items,
    ...paging,
  };
}

// ---------------------------------------------------------------------------
// By course
// ---------------------------------------------------------------------------

/**
 * One row per course: capacity, seats filled, utilization, demand (how many
 * students ranked it) and, optionally, who was assigned.
 */
export async function getResultsByCourse(runId, query = {}) {
  const {
    algorithm: requested, search, sort = "courseCode", includeStudents = true, page = 1, limit = 50,
  } = query;
  const run = await loadRun(runId);
  assertViewable(run);
  const algorithm = resolveAlgorithm(run, requested);

  const rows = await loadAssignments(run, algorithm);

  // Demand counts students, not lists: a course ranked in two groups' lists by
  // the same student is one request.
  const demandBy = new Map();
  for (const p of run.inputSnapshot?.preferences ?? []) {
    if (!demandBy.has(p.courseId)) demandBy.set(p.courseId, new Set());
    demandBy.get(p.courseId).add(p.studentId);
  }
  const demand = new Map([...demandBy].map(([course, students]) => [course, students.size]));

  const byCourse = new Map();
  for (const c of run.inputSnapshot?.courses ?? []) {
    byCourse.set(c.id, {
      courseCode: c.id, title: c.name, capacity: c.capacity, electiveGroup: c.electiveGroup ?? null, assigned: [],
    });
  }
  for (const a of rows) {
    const code = a.course?.courseCode;
    if (!code) continue;
    if (!byCourse.has(code)) {
      byCourse.set(code, {
        courseCode: code, title: a.course.title, capacity: a.course.capacity,
        electiveGroup: a.course.electiveGroup ?? null, assigned: [],
      });
    }
    byCourse.get(code).assigned.push({
      studentId: a.student?.studentId ?? null,
      name: a.student?.name ?? null,
      preferenceRank: a.preferenceRank,
      phase: a.phase ?? null,
      iteration: a.iteration ?? null,
      electiveGroup: a.electiveGroup ?? null,
    });
  }

  let list = [...byCourse.values()].map((c) => {
    const filled = c.assigned.length;
    const byPhase = {};
    for (const a of c.assigned) {
      const k = a.phase ?? "none";
      byPhase[k] = (byPhase[k] ?? 0) + 1;
    }
    c.assigned.sort((x, y) => (x.preferenceRank ?? 0) - (y.preferenceRank ?? 0) || String(x.studentId).localeCompare(String(y.studentId)));
    return {
      courseCode: c.courseCode,
      title: c.title,
      electiveGroup: c.electiveGroup,
      capacity: c.capacity,
      assignedCount: filled,
      seatsRemaining: Math.max(0, (c.capacity ?? 0) - filled),
      utilization: c.capacity > 0 ? Number((filled / c.capacity).toFixed(4)) : null,
      demand: demand.get(c.courseCode) ?? 0,
      byPhase,
      ...(includeStudents ? { students: c.assigned } : {}),
    };
  });

  if (search) {
    const q = text(search);
    list = list.filter((c) => text(c.courseCode).includes(q) || text(c.title).includes(q));
  }

  const sorters = {
    courseCode: (a, b) => a.courseCode.localeCompare(b.courseCode),
    utilization: (a, b) => (b.utilization ?? -1) - (a.utilization ?? -1) || a.courseCode.localeCompare(b.courseCode),
    assignedCount: (a, b) => b.assignedCount - a.assignedCount || a.courseCode.localeCompare(b.courseCode),
    demand: (a, b) => b.demand - a.demand || a.courseCode.localeCompare(b.courseCode),
  };
  list.sort(sorters[sort] ?? sorters.courseCode);

  const { items, ...paging } = paginate(list, page, limit);
  return {
    runId: run._id,
    algorithm,
    snapshotAvailable: Boolean(run.inputSnapshot?.courses?.length),
    courses: items,
    ...paging,
  };
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

const CSV_COLUMNS = [
  "runId", "semesterId", "algorithm", "studentId", "studentName", "cgpa", "department",
  "courseCode", "courseTitle", "electiveGroup", "preferenceRank", "phase", "iteration", "status",
];

/**
 * CSV of one algorithm's assignments for a run (admin/faculty).
 * @returns {{ filename: string, csv: string }}
 */
export async function buildRunCsv(runId, { algorithm: requested } = {}) {
  const run = await loadRun(runId, "-inputSnapshot");
  assertViewable(run);
  const algorithm = resolveAlgorithm(run, requested);

  const rows = await loadAssignments(run, algorithm);
  rows.sort(
    (a, b) =>
      String(a.student?.studentId).localeCompare(String(b.student?.studentId)) ||
      (a.preferenceRank ?? 0) - (b.preferenceRank ?? 0) ||
      String(a.course?.courseCode).localeCompare(String(b.course?.courseCode))
  );

  const lines = [CSV_COLUMNS.join(",")];
  for (const a of rows) {
    lines.push(
      [
        String(run._id), run.semesterId, algorithm,
        a.student?.studentId, a.student?.name, a.student?.cgpa, a.student?.department,
        a.course?.courseCode, a.course?.title, a.electiveGroup ?? a.course?.electiveGroup,
        a.preferenceRank, a.phase, a.iteration, a.status,
      ]
        .map(csvCell)
        .join(",")
    );
  }

  const safe = (v) => String(v).replace(/[^A-Za-z0-9_.-]/g, "_");
  return {
    filename: `allocation-${safe(run.semesterId)}-${algorithm}-${String(run._id).slice(-6)}.csv`,
    // BOM so spreadsheet software reads UTF-8 names correctly
    csv: "\uFEFF" + lines.join("\r\n") + "\r\n",
  };
}
