
import { performance } from "node:perf_hooks";

import { MinCostMaxFlow } from "./minCostMaxFlow.js";
import {
  hasTimetableClash,
  clashesWithFixedSlots,
} from "../timetable/checkClash.js";

export function allocateOptimized(
  { students, courses, preferences },
  options = {}
) {
  if (
    !Array.isArray(students) ||
    !Array.isArray(courses) ||
    !Array.isArray(preferences)
  ) {
    throw new Error(
      "Input must contain students, courses, and preferences arrays"
    );
  }

  const maxCoursesPerStudent = options.maxCoursesPerStudent ?? 2;
  const timetable = options.timetable;
  const oneCoursePerGroup = options.oneCoursePerGroup ?? true;
  const fixedTimetable = timetable ? options.fixedTimetable ?? null : null;

  // `floor` is another allocation (normally the baseline's) that the result must
  // never be worse than, student by student and group by group. `cgpaPriority`
  // makes the optimizer use CGPA itself: among allocations with the same total
  // preference cost, higher-CGPA students get the better choices.
  const floorAllocations = Array.isArray(options.floor) ? options.floor : null;
  const cgpaPriorityRequested = options.cgpaPriority ?? false;

  // Optional limits on the timetable search. With none (the default) the
  // search runs to the end and the result is optimal. With a limit the search
  // first builds a clash-free answer greedily, then improves it until the
  // limit is hit, and reports that the result may not be optimal.
  const maxFlowSolves = options.maxFlowSolves ?? Infinity;
  const searchTimeLimitMs = options.searchTimeLimitMs ?? Infinity;
  // work = edges looked at by the flow solver; unlike time it is the same on every machine,
  // so a run stopped by this limit stops at the same point every time
  const maxWork = options.maxWork ?? Infinity;
  const limited =
    maxFlowSolves !== Infinity || searchTimeLimitMs !== Infinity || maxWork !== Infinity;
  const searchStartedAt = performance.now();

  if (
    !Number.isInteger(maxCoursesPerStudent) ||
    maxCoursesPerStudent < 1
  ) {
    throw new Error("maxCoursesPerStudent must be a positive integer");
  }

  const studentById = new Map(students.map(s => [s.id, s]));
  const courseById = new Map(courses.map(c => [c.id, c]));

  if (studentById.size !== students.length) {
    throw new Error("Student IDs must be unique");
  }

  if (courseById.size !== courses.length) {
    throw new Error("Course IDs must be unique");
  }

  for (const student of students) {
    if (!student.id || !Number.isFinite(student.cgpa)) {
      throw new Error(`Invalid student: ${student.id}`);
    }
  }

  for (const course of courses) {
    if (
      !course.id ||
      !Number.isInteger(course.capacity) ||
      course.capacity < 0
    ) {
      throw new Error(`Invalid course or capacity: ${course.id}`);
    }
  }

  // Elective groups. A preference list belongs to a group (OE1, OE2, ...), a
  // course may appear in several groups' lists, and a student gets at most one
  // course per group and never the same course twice.
  const groupOfCourse = new Map(courses.map(c => [c.id, c.electiveGroup ?? null]));
  const prefGroup = p => p.electiveGroup ?? groupOfCourse.get(p.courseId) ?? null;
  const groupNames = [
    ...new Set(preferences.map(prefGroup).filter(Boolean))
  ].sort();
  const useGroups = oneCoursePerGroup && groupNames.length > 0;
  const slotOf = p => (useGroups ? prefGroup(p) ?? "" : "");
  const prefKey = p => `${p.studentId}::${p.courseId}::${slotOf(p)}`;

  const seenPairs = new Set();

  for (const p of preferences) {
    if (
      !studentById.has(p.studentId) ||
      !courseById.has(p.courseId) ||
      !Number.isInteger(p.rank) ||
      p.rank < 1
    ) {
      throw new Error(`Invalid preference for student ${p.studentId}`);
    }

    const key = prefKey(p);

    if (seenPairs.has(key)) {
      throw new Error(`Duplicate preference: ${key}`);
    }

    seenPairs.add(key);
  }

  // A course that overlaps a student's compulsory slots can never be given to
  // that student, so those preferences are left out of the network entirely.
  // This is exact and needs no branching.
  let preferencesRemovedByFixedSlots = 0;

  const usablePreferencesBeforeFloor = fixedTimetable
    ? preferences.filter(p => {
        const clash = clashesWithFixedSlots(
          p.courseId,
          fixedTimetable[p.studentId],
          timetable
        );

        if (clash) preferencesRemovedByFixedSlots++;

        return !clash;
      })
    : preferences;

  // ---- floor: nobody ends worse than the floor allocation -----------------------
  // For every (student, group) the floor gave a course, the result may only use
  // courses ranked at least as high as that one, and must still give that student
  // a course in that group (see kept below). A slot the floor left empty is free.
  const floorRank = new Map();

  if (useGroups && floorAllocations) {
    for (const a of floorAllocations) {
      if (a.electiveGroup) {
        floorRank.set(`${a.studentId}::${a.electiveGroup}`, a.preferenceRank);
      }
    }
  }

  const floorApplied = floorRank.size > 0;
  const floorSlots = floorRank.size;
  let preferencesRemovedByFloor = 0;

  const candidatePreferences = floorApplied
    ? usablePreferencesBeforeFloor.filter(p => {
        const limit = floorRank.get(`${p.studentId}::${slotOf(p)}`);
        const allowed = limit === undefined || p.rank <= limit;

        if (!allowed) preferencesRemovedByFloor++;

        return allowed;
      })
    : usablePreferencesBeforeFloor;

  // ---- costs ---------------------------------------------------------------------
  // The cost of an edge is its rank - 1. With CGPA priority each edge costs
  // (rank - 1) * (BIG + weight), where the weight grows with the student's CGPA
  // and BIG is larger than every weighted part added together. The first part
  // is the real preference cost and always wins; the weighted part only decides
  // between allocations that cost the same, in favour of higher CGPA.
  // Keeping a slot the floor filled gets a large bonus (KEEP), larger than any
  // cost difference, so the search never gives such a slot away.
  const plainMaximum = candidatePreferences.reduce((n, p) => n + (p.rank - 1), 0);
  const cgpaOf = new Map(students.map(st => [st.id, st.cgpa]));
  const cgpaLevels = [...new Set(students.map(st => st.cgpa))].sort((a, b) => a - b);
  const cgpaWeightOf = new Map(
    students.map(st => [st.id, 1 + cgpaLevels.indexOf(cgpaOf.get(st.id))])
  );

  let BIG = 1;
  let cgpaWeighted = false;

  if (cgpaPriorityRequested) {
    const weightedMaximum = candidatePreferences.reduce(
      (n, p) => n + (p.rank - 1) * cgpaWeightOf.get(p.studentId),
      0
    );
    const bigCandidate = weightedMaximum + 1;
    const keepCandidate = bigCandidate * (plainMaximum + 1);

    // all sums must stay exact integers; otherwise the weighting is switched off
    if (keepCandidate * Math.max(1, floorSlots) < 2 ** 50) {
      BIG = bigCandidate;
      cgpaWeighted = true;
    }
  }

  const KEEP = floorSlots > 0 ? BIG * (plainMaximum + 1) : 0;

  const edgeCost = p =>
    (p.rank - 1) * BIG +
    (cgpaWeighted ? (p.rank - 1) * cgpaWeightOf.get(p.studentId) : 0);

  // Stable node numbering for every MCMF solve.
  const source = 0;
  const studentStart = 1;
  const courseStart = studentStart + students.length;
  const sink = courseStart + courses.length;

  // A node per (student, group) with capacity 1 makes "at most one course per
  // group" part of the flow itself, so it is exact and needs no search. These
  // nodes come after the sink so a run without groups numbers its nodes exactly
  // as before.
  const groupStart = sink + 1;
  const groupIndex = new Map(groupNames.map((g, i) => [g, i]));
  const pairStart = groupStart + (useGroups ? students.length * groupNames.length : 0);

  // When the same course is in a student's lists for two groups, one more node
  // (capacity 1) in front of the course stops the student getting it twice.
  const pairNode = new Map();
  let nodeCount = pairStart;

  if (useGroups) {
    const listed = new Map();

    for (const p of candidatePreferences) {
      const key = `${p.studentId}::${p.courseId}`;
      listed.set(key, (listed.get(key) ?? 0) + 1);
    }

    for (const p of candidatePreferences) {
      const key = `${p.studentId}::${p.courseId}`;

      if (listed.get(key) > 1 && !pairNode.has(key)) {
        pairNode.set(key, nodeCount++);
      }
    }
  }

  const studentNode = new Map(
    students.map((s, i) => [s.id, studentStart + i])
  );

  const courseNode = new Map(
    courses.map((c, i) => [c.id, courseStart + i])
  );

  // Node -> id, so decoding a flow edge is O(1) instead of a list search.
  const studentIdByNode = new Map(
    students.map((s, i) => [studentStart + i, s.id])
  );

  const courseIdByNode = new Map(
    courses.map((c, i) => [courseStart + i, c.id])
  );

  const groupNodeOf = (studentId, group) =>
    groupStart +
    (studentNode.get(studentId) - studentStart) * groupNames.length +
    groupIndex.get(group);

  const groupNodeInfo = new Map();
  const courseOfPairNode = new Map();

  if (useGroups) {
    students.forEach((s, si) => {
      groupNames.forEach((group, gi) => {
        groupNodeInfo.set(groupStart + si * groupNames.length + gi, {
          studentId: s.id,
          group
        });
      });
    });

    for (const [key, node] of pairNode) {
      courseOfPairNode.set(node, key.split("::")[1]);
    }
  }

  const preferenceByKey = new Map(preferences.map(p => [prefKey(p), p]));

  let flowSolves = 0;
  let work = 0;
  let conflictBranches = 0;
  let stopReason = null;
  let bestSolution = null;
  const visitedStates = new Set();

  // The network is built once. A branch of the search only forbids some
  // student-course edges, so each solve resets the capacities and closes those
  // edges instead of building the whole network again.
  const network = new MinCostMaxFlow(nodeCount);
  const choiceEdges = [];
  const edgeByKey = new Map();

  for (const student of students) {
    network.addEdge(
      source,
      studentNode.get(student.id),
      maxCoursesPerStudent,
      0
    );
  }

  if (useGroups) {
    for (const student of students) {
      for (const group of groupNames) {
        network.addEdge(
          studentNode.get(student.id),
          groupNodeOf(student.id, group),
          1,
          floorRank.has(`${student.id}::${group}`) ? -KEEP : 0
        );
      }
    }
  }

  for (const [key, node] of pairNode) {
    network.addEdge(node, courseNode.get(key.split("::")[1]), 1, 0);
  }

  candidatePreferences.forEach((p, order) => {
    const group = slotOf(p);
    const from = group
      ? groupNodeOf(p.studentId, group)
      : studentNode.get(p.studentId);

    const edge = network.addEdge(
      from,
      pairNode.get(`${p.studentId}::${p.courseId}`) ??
        courseNode.get(p.courseId),
      1,
      edgeCost(p)
    );

    choiceEdges.push({ p, edge, from, order, group });
    edgeByKey.set(prefKey(p), edge);
  });

  for (const course of courses) {
    network.addEdge(
      courseNode.get(course.id),
      sink,
      course.capacity,
      0
    );
  }

  // Read the chosen edges in a fixed order (by node, then as listed) so the
  // search visits conflicts in the same order whatever the network is reused.
  choiceEdges.sort((x, y) => x.from - y.from || x.order - y.order);

  function solveFlow(forbiddenPairs) {
    flowSolves++;

    network.reset();

    // a forbidden edge is closed: no capacity now, and none to "use" when the
    // flow is read back (originalCapacity is put back below)
    const closed = [];

    for (const key of forbiddenPairs) {
      const edge = edgeByKey.get(key);

      if (edge) {
        edge.originalCapacity = 0;
        edge.capacity = 0;
        closed.push(edge);
      }
    }

    const result = network.solve(source, sink);
    work += network.scans;
    network.scans = 0;
    const allocations = [];
    let kept = 0;

    for (const { p, edge, group } of choiceEdges) {
      if (edge.originalCapacity - edge.capacity <= 0) continue;

      if (floorApplied && floorRank.has(`${p.studentId}::${group}`)) kept++;

      const allocation = {
        studentId: p.studentId,
        courseId: p.courseId,
        preferenceRank: p.rank,
        phase: "optimized"
      };

      if (useGroups && group) {
        allocation.electiveGroup = group;
      }

      allocations.push(allocation);
    }

    for (const edge of closed) {
      edge.originalCapacity = 1;
    }

    return {
      flow: result.flow,
      cost: result.cost,
      kept,
      allocations
    };
  }

  // The floor itself is a valid, clash-free answer that keeps every slot, so it
  // is the first answer the search has to beat. The result is therefore never
  // worse than the floor, even if the search is stopped straight away.
  function floorSolution() {
    const allocations = [];
    let cost = -KEEP * floorSlots;

    for (const a of floorAllocations) {
      if (!a.electiveGroup) continue;

      const p = preferenceByKey.get(`${a.studentId}::${a.courseId}::${a.electiveGroup}`);

      if (!p) return null;

      cost += edgeCost(p);
      allocations.push({
        studentId: a.studentId,
        courseId: a.courseId,
        preferenceRank: p.rank,
        phase: "optimized",
        electiveGroup: a.electiveGroup
      });
    }

    return { flow: allocations.length, cost, kept: floorSlots, allocations };
  }

  // Whether two courses overlap never changes during a run, so ask the
  // timetable once per pair (it re-parses every time string otherwise).
  const clashCache = new Map();

  function coursesClash(courseA, courseB) {
    const key = courseA < courseB
      ? `${courseA}::${courseB}`
      : `${courseB}::${courseA}`;

    let clash = clashCache.get(key);

    if (clash === undefined) {
      clash = hasTimetableClash(
        courseA,
        [{ courseId: courseB }],
        timetable
      );
      clashCache.set(key, clash);
    }

    return clash;
  }

  function findConflict(allocations) {
    if (!timetable) return null;

    const byStudent = new Map();

    for (const a of allocations) {
      if (!byStudent.has(a.studentId)) {
        byStudent.set(a.studentId, []);
      }

      byStudent.get(a.studentId).push(a);
    }

    for (const [studentId, assigned] of byStudent) {
      for (let i = 0; i < assigned.length; i++) {
        for (let j = i + 1; j < assigned.length; j++) {
          const a = assigned[i];
          const b = assigned[j];

          if (coursesClash(a.courseId, b.courseId)) {
            return [a, b];
          }
        }
      }
    }

    return null;
  }

  function tieBreakKey(solution) {
    solution.key ??= solution.allocations
      .map(a => `${a.studentId}:${a.courseId}`)
      .sort()
      .join("|");

    return solution.key;
  }

  // One clashing pair for every student that has a clash.
  function findConflicts(allocations) {
    if (!timetable) return [];

    const byStudent = new Map();

    for (const a of allocations) {
      if (!byStudent.has(a.studentId)) byStudent.set(a.studentId, []);
      byStudent.get(a.studentId).push(a);
    }

    const found = [];

    for (const assigned of byStudent.values()) {
      let pair = null;

      for (let i = 0; i < assigned.length && !pair; i++) {
        for (let j = i + 1; j < assigned.length; j++) {
          if (coursesClash(assigned[i].courseId, assigned[j].courseId)) {
            pair = [assigned[i], assigned[j]];
            break;
          }
        }
      }

      if (pair) found.push(pair);
    }

    return found;
  }

  function budgetExhausted() {
    if (stopReason) return true;

    if (flowSolves >= maxFlowSolves) {
      stopReason = "solve-limit";
    } else if (work >= maxWork) {
      stopReason = "work-limit";
    } else if (performance.now() - searchStartedAt >= searchTimeLimitMs) {
      stopReason = "time-limit";
    }

    return stopReason !== null;
  }

  // Compare solutions lexicographically:
  // first maximize assignment count, then minimize preference cost.
  function isBetter(candidate, current) {
    if (!current) return true;

    if (candidate.flow !== current.flow) {
      return candidate.flow > current.flow;
    }

    if (candidate.cost !== current.cost) {
      return candidate.cost < current.cost;
    }

    // Deterministic tie-break.
    return tieBreakKey(candidate).localeCompare(tieBreakKey(current)) < 0;
  }

  // True when nothing below this solution can beat the best clash-free one.
  // Forbidding edges only removes options, so a branch can never assign more
  // or cost less than its own flow solution. Equal cost is kept because the
  // tie-break key may still prefer it.
  function cannotBeat(solution) {
    if (!bestSolution) return false;

    if (solution.flow !== bestSolution.flow) {
      return solution.flow < bestSolution.flow;
    }

    return solution.cost > bestSolution.cost;
  }

  // Best-first search. The most promising branch (most assignments, then
  // lowest cost) is expanded first, so the first clash-free solution reached
  // is already optimal and the rest of the tree is cut off by cannotBeat.
  // Branches with an equally good bound are still expanded so the
  // deterministic tie-break sees every optimal solution.
  const queue = [];
  let queueOrder = 0;

  function isBefore(x, y) {
    if (x.solution.flow !== y.solution.flow) {
      return x.solution.flow > y.solution.flow;
    }

    if (x.solution.cost !== y.solution.cost) {
      return x.solution.cost < y.solution.cost;
    }

    return x.order < y.order;
  }

  function pushNode(node) {
    queue.push(node);
    let i = queue.length - 1;

    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!isBefore(queue[i], queue[parent])) break;
      [queue[i], queue[parent]] = [queue[parent], queue[i]];
      i = parent;
    }
  }

  function popNode() {
    const top = queue[0];
    const last = queue.pop();

    if (queue.length > 0) {
      queue[0] = last;
      let i = 0;

      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let first = i;

        if (left < queue.length && isBefore(queue[left], queue[first])) first = left;
        if (right < queue.length && isBefore(queue[right], queue[first])) first = right;
        if (first === i) break;

        [queue[i], queue[first]] = [queue[first], queue[i]];
        i = first;
      }
    }

    return top;
  }

  // Best bound among branches that were never solved because of a limit.
  let skippedBound = null;

  function enqueue(forbiddenPairs, parent = null) {
    const stateKey = [...forbiddenPairs].sort().join("|");

    if (visitedStates.has(stateKey)) return;

    if (budgetExhausted()) {
      // This branch is left unexplored; its parent bounds what it could hold.
      if (parent && (!skippedBound || isBefore({ solution: parent, order: 0 }, { solution: skippedBound, order: 1 }))) {
        skippedBound = parent;
      }

      return;
    }

    visitedStates.add(stateKey);

    const solution = solveFlow(forbiddenPairs);

    // a branch that cannot keep every slot the floor filled cannot be answered
    if (floorApplied && solution.kept < floorSlots) return;

    if (cannotBeat(solution)) return;

    pushNode({ forbiddenPairs, solution, order: queueOrder++ });
  }

  const pairKeyOf = a => `${a.studentId}::${a.courseId}::${a.electiveGroup ?? ""}`;
  const floorCourseKeys = new Set(
    floorApplied ? floorAllocations.filter(a => a.electiveGroup).map(pairKeyOf) : []
  );

  // Greedy first answer: while any student holds two clashing courses, forbid
  // the worse-ranked course of one clashing pair per student and solve again.
  function seedIncumbent(rootSolution) {
    const forbidden = new Set();
    let solution = rootSolution;

    for (;;) {
      const conflicts = findConflicts(solution.allocations);

      if (floorApplied && solution.kept < floorSlots) return;

      if (conflicts.length === 0) {
        if (isBetter(solution, bestSolution)) bestSolution = solution;
        return;
      }

      for (const [a, b] of conflicts) {
        let worse = a.preferenceRank >= b.preferenceRank ? a : b;
        const other = worse === a ? b : a;

        // the floor's own course is never given up by the dive, so it keeps
        // every slot and ends in an answer at least as good as the floor
        if (floorCourseKeys.has(pairKeyOf(worse)) && !floorCourseKeys.has(pairKeyOf(other))) {
          worse = other;
        }

        forbidden.add(pairKeyOf(worse));
      }

      if (budgetExhausted()) return;

      solution = solveFlow(forbidden);
    }
  }

  function search() {
    visitedStates.add("");

    if (floorApplied) {
      bestSolution = floorSolution();

      // a floor that does not match the preferences cannot be honoured
      if (!bestSolution) throw new Error("floor allocations must come from the students' preference lists");
    }

    const root = solveFlow(new Set());

    if (!floorApplied || root.kept === floorSlots) {
      pushNode({ forbiddenPairs: new Set(), solution: root, order: queueOrder++ });

      if (limited && timetable) seedIncumbent(root);
    }

    while (queue.length > 0) {
      if (budgetExhausted()) break;

      const { forbiddenPairs, solution } = popNode();

      // The best clash-free solution may have improved since this was queued.
      if (cannotBeat(solution)) continue;

      const conflict = findConflict(solution.allocations);

      if (!conflict) {
        if ((!floorApplied || solution.kept === floorSlots) && isBetter(solution, bestSolution)) {
          bestSolution = solution;
        }

        continue;
      }

      const [a, b] = conflict;
      const pairA = `${a.studentId}::${a.courseId}::${a.electiveGroup ?? ""}`;
      const pairB = `${b.studentId}::${b.courseId}::${b.electiveGroup ?? ""}`;

      // Any clash-free solution must exclude at least one of these edges.
      conflictBranches++;

      const branchA = new Set(forbiddenPairs);
      branchA.add(pairA);
      enqueue(branchA, solution);

      const branchB = new Set(forbiddenPairs);
      branchB.add(pairB);
      enqueue(branchB, solution);
    }
  }

  search();

  // When a limit stopped the search, how good could the answer still be?
  let searchBound = null;

  if (stopReason) {
    let bound = queue.length > 0 ? queue[0].solution : null;

    if (skippedBound && (!bound || isBefore({ solution: skippedBound, order: 0 }, { solution: bound, order: 1 }))) {
      bound = skippedBound;
    }

    if (bound && bestSolution && bound.flow >= bestSolution.flow) {
      // back to the plain preference cost: undo the keep bonus, drop the CGPA part
      searchBound = {
        assignments: bound.flow,
        preferenceCost: Math.floor((bound.cost + KEEP * floorSlots) / BIG)
      };
    }
  }

  // With no preferences, the empty allocation is a valid result.
  if (!bestSolution) {
    bestSolution = {
      flow: 0,
      cost: 0,
      allocations: []
    };
  }

  const studentCounts = new Map(
    students.map(s => [s.id, 0])
  );

  const courseCounts = new Map(
    courses.map(c => [c.id, 0])
  );

  for (const a of bestSolution.allocations) {
    studentCounts.set(
      a.studentId,
      studentCounts.get(a.studentId) + 1
    );

    courseCounts.set(
      a.courseId,
      courseCounts.get(a.courseId) + 1
    );
  }

  return {
    allocations: bestSolution.allocations,
    totalAllocated: bestSolution.flow,
    totalPreferenceCost: bestSolution.allocations.reduce(
      (n, a) => n + (a.preferenceRank - 1),
      0
    ),

    unallocatedStudentIds: students
      .filter(s => studentCounts.get(s.id) === 0)
      .map(s => s.id),

    studentSummary: students.map(s => ({
      studentId: s.id,
      coursesAllocated: studentCounts.get(s.id)
    })),

    courseSummary: courses.map(c => ({
      courseId: c.id,
      capacity: c.capacity,
      allocated: courseCounts.get(c.id),
      seatsRemaining: c.capacity - courseCounts.get(c.id)
    })),

    assumptions: {
      objective:
        "Maximize assignments, then minimize preference-rank cost" +
        (floorApplied ? "; no student ends worse than under the baseline" : "") +
        (cgpaWeighted ? "; higher CGPA gets the better choices among equal results" : ""),
      maxCoursesPerStudent,
      timetableValidationEnabled: Boolean(timetable),
      fixedTimetableEnabled: Boolean(fixedTimetable),
      oneCoursePerGroup: useGroups,
      // the floor the result may not be worse than, and CGPA used inside the optimizer
      floorApplied,
      floorSlots,
      preferencesRemovedByFloor,
      cgpaPriority: cgpaWeighted,
      preferencesRemovedByFixedSlots,
      flowSolves,
      conflictBranches,
      // false when a search limit stopped the timetable search early: the
      // result is clash-free but may not be the best possible. searchBound
      // then gives the most assignments (and the lowest cost for that many)
      // any answer could still reach.
      optimal: stopReason === null,
      searchStopReason: stopReason,
      searchBound,
      meritRandomQuotasPreserved: false
    }
  };
}
