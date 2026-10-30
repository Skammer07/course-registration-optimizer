/**
 * src/services/dataOverview.service.js
 * Read-only views of a semester's INPUT data for admin/faculty, so someone can judge whether a
 * semester is ready to run (and later understand a result) without opening the database:
 *   - getCourseDemand:       how many students ranked each course, against its seats
 *   - getPreferenceOverview: who has submitted, drafted or not started their preference lists
 *
 * Both only count what a run would use: active courses, active students, SUBMITTED lists.
 */

import Student from "../models/Student.js";
import Course from "../models/Course.js";
import Preference from "../models/Preference.js";

// ---------------------------------------------------------------------------
// Course demand
// ---------------------------------------------------------------------------

/**
 * For every course of the semester: how many submitted lists rank it at all, how many rank it
 * first and second. Courses nobody ranked are included with zeros.
 */
export async function getCourseDemand(semesterId) {
  const [courses, perCourse, lists, students] = await Promise.all([
    Course.find({ semesterId }).select("courseCode").lean(),
    Preference.aggregate([
      { $match: { semesterId, status: "submitted" } },
      { $unwind: { path: "$rankedCourseIds", includeArrayIndex: "position" } },
      {
        $group: {
          _id: "$rankedCourseIds",
          ranked: { $sum: 1 },
          firstChoice: { $sum: { $cond: [{ $eq: ["$position", 0] }, 1, 0] } },
          secondChoice: { $sum: { $cond: [{ $eq: ["$position", 1] }, 1, 0] } },
        },
      },
    ]),
    Preference.countDocuments({ semesterId, status: "submitted" }),
    Preference.distinct("student", { semesterId, status: "submitted" }),
  ]);

  const byCourse = new Map(perCourse.map((r) => [String(r._id), r]));
  return {
    semesterId,
    lists,
    studentsWithLists: students.length,
    courses: courses.map((c) => {
      const d = byCourse.get(String(c._id));
      return {
        courseId: c._id,
        courseCode: c.courseCode,
        ranked: d?.ranked ?? 0,
        firstChoice: d?.firstChoice ?? 0,
        secondChoice: d?.secondChoice ?? 0,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Preference overview
// ---------------------------------------------------------------------------

/**
 * One student's preference state. A student is expected to submit one list for each elective
 * group they may choose from (their own electiveGroups, or every group of the semester when
 * none is set, the same rule preference submission applies).
 *
 * @param {{ electiveGroups?: string[] }} student
 * @param {string[]} semesterGroups  groups that have courses in the semester
 * @param {Map<string, { status: string, count: number }>} listsByGroup  this student's lists
 * @returns {{ status: "complete"|"incomplete"|"none", groups: Record<string, { status: string, count: number }> }}
 */
export function classifyStudent(student, semesterGroups, listsByGroup) {
  const required = student.electiveGroups?.length ? student.electiveGroups : semesterGroups;
  const groups = {};
  for (const g of semesterGroups) {
    if (!required.includes(g)) {
      groups[g] = { status: "na", count: 0 };
      continue;
    }
    const list = listsByGroup.get(g);
    groups[g] = list ? { status: list.status, count: list.count } : { status: "missing", count: 0 };
  }

  const states = required.filter((g) => semesterGroups.includes(g)).map((g) => groups[g]?.status ?? "missing");
  let status = "incomplete";
  if (states.length === 0 || states.every((s) => s === "missing")) status = "none";
  else if (states.every((s) => s === "submitted")) status = "complete";
  return { status, groups };
}

const includesText = (value, needle) => String(value ?? "").toLowerCase().includes(needle);

/**
 * Students of a semester with their preference status per group, plus totals for the whole
 * semester (the totals ignore the search, department and status filters so they stay stable).
 */
export async function getPreferenceOverview({
  semesterId,
  search,
  department,
  status = "all",
  includeInactive = false,
  page = 1,
  limit = 50,
}) {
  const studentFilter = { semesterId };
  if (!includeInactive) studentFilter.isActive = true;

  const [students, courses, lists] = await Promise.all([
    Student.find(studentFilter)
      .select("studentId name cgpa department electiveGroups isActive")
      .sort({ studentId: 1 })
      .lean(),
    Course.find({ semesterId, isActive: true }).select("electiveGroup").lean(),
    Preference.aggregate([
      { $match: { semesterId } },
      {
        $project: {
          student: 1,
          electiveGroup: 1,
          status: 1,
          count: { $size: { $ifNull: ["$rankedCourseIds", []] } },
        },
      },
    ]),
  ]);

  const groups = [...new Set(courses.map((c) => c.electiveGroup).filter(Boolean))].sort();

  const listsByStudent = new Map();
  for (const l of lists) {
    const key = String(l.student);
    if (!listsByStudent.has(key)) listsByStudent.set(key, new Map());
    listsByStudent.get(key).set(l.electiveGroup, { status: l.status, count: l.count });
  }

  const summary = {
    students: 0,
    complete: 0,
    incomplete: 0,
    none: 0,
    perGroup: Object.fromEntries(groups.map((g) => [g, { submitted: 0, draft: 0, missing: 0 }])),
  };

  const rows = students.map((s) => {
    const { status: state, groups: perGroup } = classifyStudent(s, groups, listsByStudent.get(String(s._id)) ?? new Map());
    if (s.isActive !== false) {
      summary.students++;
      summary[state]++;
      for (const g of groups) {
        const st = perGroup[g].status;
        if (st === "submitted" || st === "draft" || st === "missing") summary.perGroup[g][st]++;
      }
    }
    return {
      _id: s._id,
      studentId: s.studentId,
      name: s.name,
      cgpa: s.cgpa,
      department: s.department ?? "",
      electiveGroups: s.electiveGroups ?? [],
      isActive: s.isActive !== false,
      status: state,
      groups: perGroup,
    };
  });

  const departments = [...new Set(rows.map((r) => r.department).filter(Boolean))].sort();

  const needle = search ? search.toLowerCase() : null;
  const dept = department ? department.toLowerCase() : null;
  const filtered = rows.filter(
    (r) =>
      (!needle || includesText(r.name, needle) || includesText(r.studentId, needle)) &&
      (!dept || r.department.toLowerCase() === dept) &&
      (status === "all" || r.status === status)
  );

  const start = (page - 1) * limit;
  return {
    semesterId,
    groups,
    departments,
    summary,
    students: filtered.slice(start, start + limit),
    total: filtered.length,
    page,
    limit,
    totalPages: Math.ceil(filtered.length / limit),
  };
}
