import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getResultsByStudent } from "../../api/allocations.js";
import { ErrorAlert } from "../../components/ui/Alert.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Card } from "../../components/ui/Card.jsx";
import { FilterSelect, inputClass } from "../../components/ui/Fields.jsx";
import { Icon } from "../../components/ui/Icon.jsx";
import { EmptyState, TableSkeleton, tableClass, tdClass, thClass } from "../../components/ui/Misc.jsx";
import { Pagination } from "../../components/ui/Pagination.jsx";
import { cn } from "../../components/ui/cn.js";
import { ALGORITHM_META } from "../../lib/chartTheme.js";
import { formatFixed } from "../../lib/format.js";
import { useDebounced } from "../../lib/hooks.js";
import { CourseChip } from "./CourseChip.jsx";

const PAGE_SIZE = 25;
const ORDER = ["baseline", "optimized"];

const courseKey = (c) => `${c.electiveGroup ?? ""}|${c.courseCode}`;

function AlgorithmName({ algorithm }) {
  const meta = ALGORITHM_META[algorithm];
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-ink">
      <span aria-hidden="true" className="inline-block size-2.5 rounded-sm" style={{ background: meta?.color }} />
      {meta?.label ?? algorithm}
    </span>
  );
}

/** The student's result under each algorithm, whichever one the page is currently sorting by. */
function sidesOf(student, viewed) {
  const mine = { courses: student.courses, count: student.coursesAllocated, avg: student.averageRank };
  const theirs = { courses: student.other.courses, count: student.other.coursesAllocated, avg: student.other.averageRank };
  return { [viewed]: mine, [student.other.algorithm]: theirs };
}

/**
 * How the optimizer's result compares with the baseline's for one student: more courses is
 * better; with the same number of courses, a lower average rank is better.
 */
function verdictFor(student, sides) {
  if (!student.differs) return { tone: "neutral", icon: "check", label: "Same", detail: "Identical courses" };
  const b = sides.baseline;
  const o = sides.optimized;
  const rankText = b.avg !== null || o.avg !== null ? `avg rank ${b.avg === null ? "–" : formatFixed(b.avg, 2)} → ${o.avg === null ? "–" : formatFixed(o.avg, 2)}` : "";
  if (o.count !== b.count) {
    const text = `${b.count} → ${o.count} course${o.count === 1 ? "" : "s"}`;
    return o.count > b.count
      ? { tone: "good", icon: "check", label: "Improved", detail: text }
      : { tone: "critical", icon: "alert", label: "Worse", detail: text };
  }
  if (b.avg !== null && o.avg !== null && b.avg !== o.avg) {
    return o.avg < b.avg
      ? { tone: "good", icon: "check", label: "Improved", detail: rankText }
      : { tone: "critical", icon: "alert", label: "Worse", detail: rankText };
  }
  return { tone: "warning", icon: "info", label: "Different courses", detail: rankText ? `${rankText} (equal)` : "Same rank" };
}

/** One algorithm's courses for a student. A course with an outline is one the other side did not give. */
function ResultCell({ side, otherSide }) {
  if (side.courses.length === 0) return <span className="text-sm text-ink-3">No course</span>;
  const otherKeys = new Set(otherSide.courses.map(courseKey));
  return (
    <div className="flex flex-wrap gap-1.5">
      {side.courses.map((c) => <CourseChip key={courseKey(c)} course={c} differs={!otherKeys.has(courseKey(c))} />)}
    </div>
  );
}

/** Column heading for one algorithm: its colour and its name. */
function AlgorithmHeading({ algorithm }) {
  return (
    <th scope="col" className={cn(thClass, "min-w-56")} style={{ boxShadow: `inset 0 3px 0 ${ALGORITHM_META[algorithm].color}` }}>
      <span className="flex items-center gap-2 pt-1 normal-case tracking-normal">
        <AlgorithmName algorithm={algorithm} />
        <span className="text-xs font-normal text-ink-3">· courses (number = choice rank)</span>
      </span>
    </th>
  );
}

/** One row per student, including the ones who got nothing. */
export function StudentsTab({ runId, algorithm: defaultAlgorithm, comparable = false }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("studentId");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);

  // With both algorithms on screen there is no "which one" switch: the algorithm-specific sorts
  // are written "averageRank@optimized", and everything else works on all students.
  const [sortKey, sortAlgorithm] = sort.split("@");
  const algorithm = sortAlgorithm ?? defaultAlgorithm;

  // a new filter or algorithm always starts again from the first page
  useEffect(() => setPage(1), [algorithm, debounced, status, sort]);

  const query = useQuery({
    queryKey: ["runs", runId, "students", { algorithm, search: debounced, status, sort: sortKey, page }],
    queryFn: () => getResultsByStudent(runId, { algorithm, search: debounced, status, sort: sortKey, page, limit: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const filtered = Boolean(debounced) || status !== "all";
  const compare = data?.compare;
  const comparing = Boolean(compare?.available);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative block min-w-56 flex-1 sm:max-w-xs">
          <span className="sr-only">Search students</span>
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or id" className={cn(inputClass, "h-9 pl-9")} />
        </label>
        <FilterSelect label="Show" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All students</option>
          {comparable ? (
            <>
              <option value="differs">Different in the two algorithms</option>
              <option value="same">Same in both</option>
            </>
          ) : (
            <>
              <option value="allocated">With a course</option>
              <option value="unallocated">Without a course</option>
            </>
          )}
        </FilterSelect>
        <FilterSelect label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="studentId">Sort: student id</option>
          <option value="name">Sort: name</option>
          <option value="cgpa">Sort: CGPA (high first)</option>
          {comparable ? (
            ORDER.map((a) => (
              <optgroup key={a} label={ALGORITHM_META[a].label}>
                <option value={`averageRank@${a}`}>Sort: best average rank · {ALGORITHM_META[a].label}</option>
                <option value={`coursesAllocated@${a}`}>Sort: most courses · {ALGORITHM_META[a].label}</option>
              </optgroup>
            ))
          ) : (
            <>
              <option value="coursesAllocated">Sort: most courses</option>
              <option value="averageRank">Sort: best average rank</option>
            </>
          )}
        </FilterSelect>
      </div>

      {comparing ? (
        <p className="rounded-lg bg-wash px-3 py-2 text-sm text-ink-2" role="status">
          <span className="tabular font-semibold text-ink">{compare.differing}</span> of <span className="tabular">{compare.total}</span> students get different courses
          under the two algorithms. A course with an outline is one the other algorithm did not give that student.
        </p>
      ) : null}

      {query.error && !data ? <ErrorAlert error={query.error} /> : null}

      {query.error && !data ? null : (
        <Card className="overflow-hidden">
          {query.isPending ? (
            <TableSkeleton />
          ) : data?.students?.length === 0 ? (
            <EmptyState icon="search" title={filtered ? "No students match" : "No students in this run"} description={filtered ? "Try a different search or filter." : undefined} />
          ) : (
            <div className={cn("overflow-x-auto transition-opacity", query.isPlaceholderData && "opacity-60")}>
              <table className={tableClass}>
                <caption className="sr-only">Students and the courses they were given</caption>
                <thead>
                  <tr>
                    <th scope="col" className={thClass}>Student</th>
                    <th scope="col" className={cn(thClass, "text-right")}>CGPA</th>
                    {comparing ? (
                      <>
                        {ORDER.map((a) => <AlgorithmHeading key={a} algorithm={a} />)}
                        <th scope="col" className={thClass}>Optimized vs Baseline</th>
                      </>
                    ) : (
                      <>
                        <th scope="col" className={thClass}>Courses given (number = choice rank)</th>
                        <th scope="col" className={cn(thClass, "text-right")}>Avg rank</th>
                        <th scope="col" className={thClass}>Result</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.students.map((s) => {
                    const sides = comparing ? sidesOf(s, algorithm) : null;
                    const verdict = comparing ? verdictFor(s, sides) : null;
                    return (
                      <tr key={s.studentId} className={comparing && s.differs ? "bg-warning-soft/30" : undefined}>
                        <th scope="row" className={cn(tdClass, "font-normal")}>
                          <span className="font-medium text-ink">{s.name}</span>
                          <span className="block text-xs text-ink-3">{s.studentId}</span>
                        </th>
                        <td className={cn(tdClass, "tabular text-right")}>{formatFixed(s.cgpa, 2)}</td>
                        {comparing ? (
                          <>
                            {ORDER.map((a) => (
                              <td key={a} className={tdClass}>
                                <ResultCell side={sides[a]} otherSide={sides[a === "baseline" ? "optimized" : "baseline"]} />
                                <span className="tabular mt-1 block text-xs text-ink-3">
                                  {sides[a].count} course{sides[a].count === 1 ? "" : "s"}
                                  {sides[a].avg !== null ? ` · avg rank ${formatFixed(sides[a].avg, 2)}` : ""}
                                </span>
                              </td>
                            ))}
                            <td className={tdClass}>
                              <Badge tone={verdict.tone} icon={verdict.icon}>{verdict.label}</Badge>
                              <span className="tabular mt-1 block text-xs text-ink-3">{verdict.detail}</span>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className={tdClass}>
                              {s.courses.length === 0 ? (
                                <span className="text-ink-3">None</span>
                              ) : (
                                <div className="flex flex-wrap gap-1.5">
                                  {s.courses.map((c) => <CourseChip key={c.courseCode} course={c} />)}
                                </div>
                              )}
                            </td>
                            <td className={cn(tdClass, "tabular text-right")}>{s.averageRank === null ? "–" : formatFixed(s.averageRank, 2)}</td>
                            <td className={tdClass}>
                              {s.status === "allocated" ? (
                                <Badge tone="neutral" icon="check">{s.coursesAllocated} course{s.coursesAllocated === 1 ? "" : "s"}</Badge>
                              ) : (
                                <Badge tone="warning" icon="alert">No course</Badge>
                              )}
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {data ? <Pagination page={data.page} limit={data.limit} total={data.total} totalPages={data.totalPages} onPage={setPage} noun="students" /> : null}
    </div>
  );
}
