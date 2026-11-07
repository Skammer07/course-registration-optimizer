import { Fragment, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getResultsByCourse } from "../../api/allocations.js";
import { ErrorAlert } from "../../components/ui/Alert.jsx";
import { Card } from "../../components/ui/Card.jsx";
import { FilterSelect } from "../../components/ui/Fields.jsx";
import { Icon } from "../../components/ui/Icon.jsx";
import { EmptyState, Meter, TableSkeleton, tableClass, tdClass, thClass } from "../../components/ui/Misc.jsx";
import { cn } from "../../components/ui/cn.js";
import { ALGORITHM_META } from "../../lib/chartTheme.js";
import { formatFraction, formatInt, ordinal } from "../../lib/format.js";
import { phaseLabel } from "./CourseChip.jsx";

/** One row per course: how full it is, how many wanted it, and (on request) who got it. */
export function CoursesTab({ runId, algorithm }) {
  const [sort, setSort] = useState("courseCode");
  const [open, setOpen] = useState(() => new Set());

  const query = useQuery({
    queryKey: ["runs", runId, "courses", { algorithm, sort }],
    queryFn: () => getResultsByCourse(runId, { algorithm, sort, includeStudents: true, limit: 200 }),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const color = ALGORITHM_META[algorithm]?.color;

  const toggle = (code) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label="Sort by" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="courseCode">Sort: course code</option>
          <option value="utilization">Sort: fullest first</option>
          <option value="demand">Sort: most requested</option>
          <option value="assignedCount">Sort: most students</option>
        </FilterSelect>
      </div>

      {query.error && !data ? <ErrorAlert error={query.error} /> : null}

      {query.error && !data ? null : (
        <Card className="overflow-hidden">
          {query.isPending ? (
            <TableSkeleton />
          ) : data?.courses?.length === 0 ? (
            <EmptyState icon="book" title="No courses in this run" />
          ) : (
            <div className={cn("overflow-x-auto transition-opacity", query.isPlaceholderData && "opacity-60")}>
              <table className={tableClass}>
                <caption className="sr-only">Courses with seats filled and demand</caption>
                <thead>
                  <tr>
                    <th scope="col" className={thClass}>Course</th>
                    <th scope="col" className={thClass}>Seats filled</th>
                    <th scope="col" className={cn(thClass, "text-right")}>Requested by</th>
                    <th scope="col" className={thClass}>Given by</th>
                    <th scope="col" className={thClass}><span className="sr-only">Students</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.courses.map((c) => {
                    const expanded = open.has(c.courseCode);
                    const detailId = `students-${c.courseCode}`;
                    return (
                      <Fragment key={c.courseCode}>
                        <tr>
                          <th scope="row" className={cn(tdClass, "font-normal")}>
                            <span className="font-medium text-ink">{c.courseCode}</span>
                            <span className="block text-xs text-ink-3">{c.title}{c.electiveGroup ? ` · group ${c.electiveGroup}` : ""}</span>
                          </th>
                          <td className={cn(tdClass, "min-w-48")}>
                            <div className="flex items-center gap-3">
                              <Meter value={c.assignedCount} max={c.capacity} label={`${c.courseCode} seats filled`} color={color} className="max-w-40 flex-1" />
                              <span className="tabular whitespace-nowrap text-ink">
                                {formatInt(c.assignedCount)}/{formatInt(c.capacity)}
                                <span className="ml-1.5 text-ink-3">{formatFraction(c.utilization)}</span>
                              </span>
                            </div>
                          </td>
                          <td className={cn(tdClass, "tabular text-right")}>{formatInt(c.demand)} students</td>
                          <td className={cn(tdClass, "text-ink-2")}>
                            {Object.keys(c.byPhase ?? {}).length === 0
                              ? "–"
                              : Object.entries(c.byPhase)
                                  .map(([phase, n]) => `${n} ${phaseLabel(phase) ?? "optimizer"}`)
                                  .join(" · ")}
                          </td>
                          <td className={cn(tdClass, "text-right")}>
                            {c.assignedCount > 0 ? (
                              <button
                                type="button"
                                aria-expanded={expanded}
                                aria-controls={detailId}
                                onClick={() => toggle(c.courseCode)}
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-ink-2 hover:bg-wash hover:text-ink"
                              >
                                {expanded ? "Hide" : "Show"} students
                                <Icon name="chevronDown" className={cn("size-4 transition-transform", expanded && "rotate-180")} />
                              </button>
                            ) : null}
                          </td>
                        </tr>
                        {expanded ? (
                          <tr id={detailId}>
                            <td colSpan={5} className="border-b border-line bg-wash/50 px-4 py-3">
                              <ul className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
                                {(c.students ?? []).map((s) => (
                                  <li key={s.studentId} className="flex items-baseline justify-between gap-3">
                                    <span className="truncate text-ink">{s.name} <span className="text-ink-3">{s.studentId}</span></span>
                                    <span className="whitespace-nowrap text-xs text-ink-3">
                                      {ordinal(s.preferenceRank)} choice{phaseLabel(s.phase, s.iteration) ? ` · ${phaseLabel(s.phase, s.iteration)}` : ""}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
