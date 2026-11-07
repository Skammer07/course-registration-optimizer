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

/** What the other algorithm gave this student, shown only where the two results differ. */
function OtherResult({ other }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-dashed border-line pt-2 text-xs text-ink-3">
      <AlgorithmName algorithm={other.algorithm} />
      <span>gives</span>
      {other.courses.length === 0 ? (
        <span>no course</span>
      ) : (
        other.courses.map((c) => <CourseChip key={courseKey(c)} course={c} />)
      )}
      {other.averageRank !== null ? <span className="tabular">(avg rank {formatFixed(other.averageRank, 2)})</span> : null}
    </div>
  );
}

/** One row per student, including the ones who got nothing. */
export function StudentsTab({ runId, algorithm }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("studentId");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search);

  // a new filter or algorithm always starts again from the first page
  useEffect(() => setPage(1), [algorithm, debounced, status, sort]);

  const query = useQuery({
    queryKey: ["runs", runId, "students", { algorithm, search: debounced, status, sort, page }],
    queryFn: () => getResultsByStudent(runId, { algorithm, search: debounced, status, sort, page, limit: PAGE_SIZE }),
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
          <option value="allocated">With a course</option>
          <option value="unallocated">Without a course</option>
          {comparing ? <option value="differs">Different in the two algorithms</option> : null}
          {comparing ? <option value="same">Same in both</option> : null}
        </FilterSelect>
        <FilterSelect label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="studentId">Sort: student id</option>
          <option value="name">Sort: name</option>
          <option value="cgpa">Sort: CGPA (high first)</option>
          <option value="coursesAllocated">Sort: most courses</option>
          <option value="averageRank">Sort: best average rank</option>
        </FilterSelect>
      </div>

      {comparing ? (
        <p className="rounded-lg bg-wash px-3 py-2 text-sm text-ink-2" role="status">
          <span className="font-semibold text-ink tabular">{compare.differing}</span> of <span className="tabular">{compare.total}</span> students get
          different courses under <AlgorithmName algorithm={compare.otherAlgorithm} /> than under <AlgorithmName algorithm={algorithm} />.
          {compare.differing > 0 ? " A course with an outline is one the other algorithm did not give that student." : ""}
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
                    <th scope="col" className={thClass}>Courses given (number = choice rank)</th>
                    <th scope="col" className={cn(thClass, "text-right")}>Avg rank</th>
                    <th scope="col" className={thClass}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {data.students.map((s) => (
                    <tr key={s.studentId}>
                      <th scope="row" className={cn(tdClass, "font-normal")}>
                        <span className="font-medium text-ink">{s.name}</span>
                        <span className="block text-xs text-ink-3">{s.studentId}</span>
                      </th>
                      <td className={cn(tdClass, "tabular text-right")}>{formatFixed(s.cgpa, 2)}</td>
                      <td className={tdClass}>
                        {s.courses.length === 0 ? (
                          <span className="text-ink-3">None</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {s.courses.map((c) => (
                              <CourseChip key={c.courseCode} course={c} differs={s.differs && !s.other.courses.some((o) => courseKey(o) === courseKey(c))} />
                            ))}
                          </div>
                        )}
                        {s.differs ? <OtherResult other={s.other} /> : null}
                      </td>
                      <td className={cn(tdClass, "tabular text-right")}>{s.averageRank === null ? "–" : formatFixed(s.averageRank, 2)}</td>
                      <td className={tdClass}>
                        {comparing ? (
                          s.differs ? <Badge tone="warning" icon="alert" className="mb-1">Differs</Badge> : <Badge tone="neutral" icon="check" className="mb-1">Same</Badge>
                        ) : null}
                        <br className={comparing ? undefined : "hidden"} />
                        {s.status === "allocated" ? (
                          <Badge tone="neutral" icon="check">{s.coursesAllocated} course{s.coursesAllocated === 1 ? "" : "s"}</Badge>
                        ) : (
                          <Badge tone="warning" icon="alert">No course</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
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
