
import { MinCostMaxFlow } from "./minCostMaxFlow.js";
import { hasTimetableClash } from "../timetable/checkClash.js";

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

    const key = `${p.studentId}::${p.courseId}`;

    if (seenPairs.has(key)) {
      throw new Error(`Duplicate preference: ${key}`);
    }

    seenPairs.add(key);
  }

  // Stable node numbering for every MCMF solve.
  const source = 0;
  const studentStart = 1;
  const courseStart = studentStart + students.length;
  const sink = courseStart + courses.length;
  const nodeCount = sink + 1;

  const studentNode = new Map(
    students.map((s, i) => [s.id, studentStart + i])
  );

  const courseNode = new Map(
    courses.map((c, i) => [c.id, courseStart + i])
  );

  const preferenceByPair = new Map(
    preferences.map(p => [
      `${p.studentId}::${p.courseId}`,
      p
    ])
  );

  let flowSolves = 0;
  let conflictBranches = 0;
  let bestSolution = null;
  const visitedStates = new Set();

  function solveFlow(forbiddenPairs) {
    flowSolves++;

    const network = new MinCostMaxFlow(nodeCount);

    for (const student of students) {
      network.addEdge(
        source,
        studentNode.get(student.id),
        maxCoursesPerStudent,
        0
      );
    }

    for (const p of preferences) {
      const key = `${p.studentId}::${p.courseId}`;

      if (forbiddenPairs.has(key)) continue;

      network.addEdge(
        studentNode.get(p.studentId),
        courseNode.get(p.courseId),
        1,
        p.rank - 1
      );
    }

    for (const course of courses) {
      network.addEdge(
        courseNode.get(course.id),
        sink,
        course.capacity,
        0
      );
    }

    const result = network.solve(source, sink);
    const allocations = [];

    for (const edge of network.getEdges()) {
      if (edge.flow <= 0) continue;

      const studentId = students.find(
        s => studentNode.get(s.id) === edge.from
      )?.id;

      const courseId = courses.find(
        c => courseNode.get(c.id) === edge.to
      )?.id;

      // Only retain student -> course edges.
      if (studentId === undefined || courseId === undefined) {
        continue;
      }

      const p = preferenceByPair.get(`${studentId}::${courseId}`);

      allocations.push({
        studentId,
        courseId,
        preferenceRank: p.rank,
        phase: "optimized"
      });
    }

    return {
      flow: result.flow,
      cost: result.cost,
      allocations
    };
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

          if (
            hasTimetableClash(
              a.courseId,
              [{ studentId, courseId: b.courseId }],
              timetable
            )
          ) {
            return [a, b];
          }
        }
      }
    }

    return null;
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
    const key = solution =>
      solution.allocations
        .map(a => `${a.studentId}:${a.courseId}`)
        .sort()
        .join("|");

    return key(candidate).localeCompare(key(current)) < 0;
  }

  function search(forbiddenPairs) {
    const stateKey = [...forbiddenPairs].sort().join("|");

    if (visitedStates.has(stateKey)) return;
    visitedStates.add(stateKey);

    const solution = solveFlow(forbiddenPairs);

    // A flow solution is an upper bound on assignments reachable
    // from this branch. If it cannot beat the current best, prune it.
    if (
      bestSolution &&
      solution.flow < bestSolution.flow
    ) {
      return;
    }

    const conflict = findConflict(solution.allocations);

    if (!conflict) {
      if (isBetter(solution, bestSolution)) {
        bestSolution = solution;
      }

      return;
    }

    const [a, b] = conflict;
    const pairA = `${a.studentId}::${a.courseId}`;
    const pairB = `${b.studentId}::${b.courseId}`;

    // Any clash-free solution must exclude at least one of these edges.
    // Explore both alternatives, preserving the better feasible result.
    conflictBranches++;

    const branchA = new Set(forbiddenPairs);
    branchA.add(pairA);
    search(branchA);

    const branchB = new Set(forbiddenPairs);
    branchB.add(pairB);
    search(branchB);
  }

  search(new Set());

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
    totalPreferenceCost: bestSolution.cost,

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
      objective: "Maximize assignments, then minimize preference-rank cost",
      maxCoursesPerStudent,
      timetableValidationEnabled: Boolean(timetable),
      flowSolves,
      conflictBranches,
      meritRandomQuotasPreserved: false
    }
  };
}
