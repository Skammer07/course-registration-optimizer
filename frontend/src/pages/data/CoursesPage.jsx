import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getCourseDemand, listCourses } from "../../api/data.js";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { Alert, ErrorAlert } from "../../components/ui/Alert.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Card } from "../../components/ui/Card.jsx";
import { FilterSelect, inputClass } from "../../components/ui/Fields.jsx";
import { Icon } from "../../components/ui/Icon.jsx";
import { EmptyState, Meter, PageHeader, TableSkeleton, tableClass, tdClass, thClass } from "../../components/ui/Misc.jsx";
import { StatRow, StatTile } from "../../components/ui/StatTile.jsx";
import { Tabs } from "../../components/ui/Tabs.jsx";
import { cn } from "../../components/ui/cn.js";
import { CourseFormDialog } from "../../features/data/CourseFormDialog.jsx";
import { TimetableGrid } from "../../features/data/TimetableGrid.jsx";
import { NoSemester, SemesterSelect, useSelectedSemester } from "../../features/semesters/SemesterSelect.jsx";
import { formatInt, plural } from "../../lib/format.js";
import { useDebounced, useDocumentTitle, useQueryParams } from "../../lib/hooks.js";
import { clashingCodes, coursesWithoutSlots, findClashes, formatSlot } from "../../lib/timetable.js";

const SORTS = {
  code: { label: "Course code", compare: (a, b) => a.courseCode.localeCompare(b.courseCode) },
  demand: { label: "Most ranked", compare: (a, b) => b.ranked - a.ranked || a.courseCode.localeCompare(b.courseCode) },
  seats: { label: "Most seats", compare: (a, b) => b.capacity - a.capacity || a.courseCode.localeCompare(b.courseCode) },
  pressure: { label: "Most oversubscribed", compare: (a, b) => b.pressure - a.pressure || a.courseCode.localeCompare(b.courseCode) },
};

const VIEW_TABS = [
  { value: "list", label: "Courses" },
  { value: "timetable", label: "Weekly timetable" },
];

function SlotChips({ slots, clash }) {
  if (!slots?.length) return <span className="text-ink-3">No fixed time</span>;
  return (
    <ul className="flex flex-wrap gap-1">
      {slots.map((s, i) => (
        <li key={i} className={cn("tabular rounded-md px-1.5 py-0.5 text-xs", clash ? "bg-warning-soft text-warning-ink" : "bg-wash text-ink-2")}>
          {formatSlot(s)}
        </li>
      ))}
    </ul>
  );
}

function DemandCell({ course }) {
  if (course.ranked === 0) return <span className="text-ink-3">Not ranked yet</span>;
  const over = course.ranked > course.capacity;
  return (
    <div className="w-44">
      <Meter value={Math.min(course.ranked, Math.max(course.capacity, 1))} max={Math.max(course.capacity, 1)} label={`${course.courseCode}: ${course.ranked} students ranked it for ${course.capacity} seats`} color={over ? "var(--color-optimized)" : "var(--color-baseline)"} />
      <p className="tabular mt-1 text-xs text-ink-2">
        ranked by {formatInt(course.ranked)} · {plural(course.capacity, "seat")}
        {over ? <span className="font-medium"> · {formatInt(course.ranked - course.capacity)} over</span> : null}
      </p>
      {course.firstChoice > 0 ? <p className="tabular text-xs text-ink-3">{formatInt(course.firstChoice)} as first choice</p> : null}
    </div>
  );
}

export function CoursesPage() {
  useDocumentTitle("Courses");
  const { user } = useAuth();
  const isAdmin = user.role === "admin";
  const { semesterId, setSemester, overview } = useSelectedSemester();
  const [params, update] = useQueryParams();

  const view = params.get("view") === "timetable" ? "timetable" : "list";
  const group = params.get("group") ?? "";
  const kind = params.get("kind") ?? "";
  const sort = SORTS[params.get("sort")] ? params.get("sort") : "code";
  const showInactive = params.get("inactive") === "1";
  const [searchText, setSearchText] = useState("");
  const search = useDebounced(searchText.trim().toLowerCase(), 200);

  const [dialog, setDialog] = useState({ open: false, course: null });

  const courses = useQuery({
    queryKey: ["data", "courses", semesterId],
    queryFn: () => listCourses({ semesterId, limit: 200 }),
    enabled: Boolean(semesterId),
    placeholderData: keepPreviousData,
  });
  const demand = useQuery({
    queryKey: ["data", "demand", semesterId],
    queryFn: () => getCourseDemand(semesterId),
    enabled: Boolean(semesterId),
    retry: false,
  });

  const rows = useMemo(() => {
    const byCode = new Map((demand.data?.courses ?? []).map((d) => [d.courseCode, d]));
    return (courses.data?.courses ?? []).map((c) => {
      const d = byCode.get(c.courseCode);
      const ranked = d?.ranked ?? 0;
      return { ...c, ranked, firstChoice: d?.firstChoice ?? 0, pressure: c.capacity > 0 ? ranked / c.capacity : ranked > 0 ? Infinity : 0 };
    });
  }, [courses.data, demand.data]);

  const active = rows.filter((c) => c.isActive !== false);
  // Compulsory courses are not allocated, so they stay out of the seat, demand and clash figures
  const activeElectives = active.filter((c) => c.kind !== "compulsory");
  const groups = [...new Set(rows.map((c) => c.electiveGroup).filter(Boolean))].sort();

  const visible = rows
    .filter((c) => showInactive || c.isActive !== false)
    // an open elective (no group of its own) belongs to every group
    .filter((c) => !group || c.electiveGroup === group || (c.electiveGroup == null && c.kind !== "compulsory"))
    .filter((c) => !kind || (kind === "compulsory") === (c.kind === "compulsory"))
    .filter((c) => !search || c.courseCode.toLowerCase().includes(search) || (c.title ?? "").toLowerCase().includes(search))
    .sort(SORTS[sort].compare);

  const clashes = findClashes(visible.filter((c) => c.isActive !== false && c.kind !== "compulsory"));
  const clashing = clashingCodes(clashes);
  const withoutSlots = coursesWithoutSlots(activeElectives);
  const partialTimetable = withoutSlots.length > 0 && withoutSlots.length < activeElectives.length;
  const totalSeats = activeElectives.reduce((sum, c) => sum + (c.capacity ?? 0), 0);
  const inDemand = activeElectives.filter((c) => c.ranked > 0).length;

  const filtered = Boolean(group || kind || search || showInactive);
  const loadingFirst = courses.isPending && Boolean(semesterId);

  const openEdit = (course) => setDialog({ open: true, course });
  const closeDialog = () => setDialog((d) => ({ ...d, open: false }));

  return (
    <>
      <PageHeader
        title="Courses"
        subtitle="What each elective offers, when it meets, and how many students want it."
        actions={
          semesterId ? (
            <Button variant="primary" icon="plus" onClick={() => setDialog({ open: true, course: null })}>Add course</Button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SemesterSelect semesterId={semesterId} setSemester={setSemester} overview={overview} />
        {semesterId ? (
          <>
            <FilterSelect label="Type" value={kind} onChange={(e) => update({ kind: e.target.value })}>
              <option value="">All types</option>
              <option value="elective">Electives</option>
              <option value="compulsory">Compulsory</option>
            </FilterSelect>
            <FilterSelect label="Elective group" value={group} onChange={(e) => update({ group: e.target.value })}>
              <option value="">All groups</option>
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </FilterSelect>
            <label className="relative block">
              <span className="sr-only">Search courses</span>
              <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
              <input
                type="search"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search code or title"
                aria-label="Search courses"
                className={cn(inputClass, "h-9 w-56 pl-8")}
              />
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => update({ inactive: e.target.checked ? "1" : undefined })}
                className="size-4 accent-[var(--color-accent)]"
              />
              Show inactive
            </label>
          </>
        ) : null}
      </div>

      {!semesterId ? (
        <Card><NoSemester overview={overview} isAdmin={isAdmin} /></Card>
      ) : courses.error && !courses.data ? (
        <ErrorAlert error={courses.error} />
      ) : (
        <div className="space-y-4">
          <StatRow label="Courses at a glance">
            <StatTile label="Active courses" value={loadingFirst ? "–" : formatInt(active.length)} hint={rows.length > active.length ? `${rows.length - active.length} inactive` : "All are active"} />
            <StatTile label="Seats in total" value={loadingFirst ? "–" : formatInt(totalSeats)} hint="Across active courses" />
            <StatTile
              label="Students with a list"
              value={demand.data ? formatInt(demand.data.studentsWithLists) : "–"}
              hint={demand.error ? "Demand is unavailable" : "Submitted preference lists only"}
            />
            <StatTile label="Courses someone ranked" value={demand.data ? `${formatInt(inDemand)} of ${formatInt(active.length)}` : "–"} hint="Active courses on at least one list" />
          </StatRow>

          {partialTimetable ? (
            <Alert tone="warning" title="Only some courses have a timetable">
              {withoutSlots.length} of {active.length} active courses have no time slots ({withoutSlots.slice(0, 5).map((c) => c.courseCode).join(", ")}
              {withoutSlots.length > 5 ? ", …" : ""}). A run with the timetable clash check turned on is refused until every course has times, or none do.
            </Alert>
          ) : null}

          <Tabs value={view} onChange={(v) => update({ view: v === "list" ? undefined : v })} tabs={VIEW_TABS} label="Course views" prefix="courses" />

          {view === "list" ? (
            <Card className="overflow-hidden" role="tabpanel" aria-labelledby="courses-tab-list">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                <p className="text-sm text-ink-2" aria-live="polite">
                  {loadingFirst ? "Loading courses…" : `${plural(visible.length, "course")}${filtered ? " match the filters" : ""}`}
                </p>
                <FilterSelect label="Sort courses" value={sort} onChange={(e) => update({ sort: e.target.value === "code" ? undefined : e.target.value })}>
                  {Object.entries(SORTS).map(([key, s]) => <option key={key} value={key}>{`Sort: ${s.label}`}</option>)}
                </FilterSelect>
              </div>

              {loadingFirst ? (
                <TableSkeleton />
              ) : visible.length === 0 ? (
                <EmptyState
                  icon="book"
                  title={filtered ? "No courses match these filters" : "This semester has no courses yet"}
                  description={filtered ? "Try a different group or search." : "Add the first course, or import a courses CSV."}
                  action={!filtered ? <Button variant="primary" icon="plus" onClick={() => setDialog({ open: true, course: null })}>Add course</Button> : null}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className={tableClass}>
                    <caption className="sr-only">Courses of {semesterId}</caption>
                    <thead>
                      <tr>
                        <th scope="col" className={thClass}>Course</th>
                        <th scope="col" className={thClass}>Group</th>
                        <th scope="col" className={cn(thClass, "text-right")}>Seats</th>
                        <th scope="col" className={thClass}>Demand</th>
                        <th scope="col" className={thClass}>Meets</th>
                        <th scope="col" className={thClass}><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((c) => (
                        <tr key={c._id} className={cn("transition-colors hover:bg-wash/60", c.isActive === false && "text-ink-3")}>
                          <td className={tdClass}>
                            <p className="font-medium text-ink">{c.courseCode}</p>
                            <p className="max-w-64 text-ink-2">{c.title}</p>
                            {c.kind === "compulsory" ? (
                              <Badge tone="accent" className="mt-1 mr-1">Compulsory · {(c.departments ?? []).join(", ")}</Badge>
                            ) : null}
                            {c.isActive === false ? <Badge tone="neutral" icon="ban" className="mt-1">Inactive</Badge> : null}
                          </td>
                          <td className={tdClass}>{c.electiveGroup ?? (c.kind === "compulsory" ? <span className="text-ink-3">–</span> : <span className="text-ink-2">All groups</span>)}</td>
                          <td className={cn(tdClass, "tabular text-right")}>{c.kind === "compulsory" ? <span className="text-ink-3">–</span> : formatInt(c.capacity)}</td>
                          <td className={tdClass}>{c.kind === "compulsory" ? <span className="text-ink-3">Not allocated</span> : <DemandCell course={c} />}</td>
                          <td className={tdClass}>
                            <SlotChips slots={c.timetableSlots} clash={clashing.has(c.courseCode)} />
                            {clashing.has(c.courseCode) ? (
                              <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-warning-ink">
                                <Icon name="alert" className="size-3.5" /> Overlaps another course
                              </p>
                            ) : null}
                          </td>
                          <td className={cn(tdClass, "text-right")}>
                            <Button size="sm" variant="ghost" icon="edit" onClick={() => openEdit(c)} aria-label={`Edit ${c.courseCode}`}>Edit</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          ) : (
            <div role="tabpanel" aria-labelledby="courses-tab-timetable" className="space-y-4">
              {loadingFirst ? (
                <Card><TableSkeleton rows={8} /></Card>
              ) : visible.every((c) => !c.timetableSlots?.length) ? (
                <Card>
                  <EmptyState icon="clock" title="No course here has a time slot" description="Add weekly times to a course to see the timetable and find clashes." />
                </Card>
              ) : (
                <>
                  <TimetableGrid courses={visible.filter((c) => c.isActive !== false)} onSelect={(code) => { setSearchText(code); update({ view: undefined }); }} />
                  <Card>
                    <div className="px-4 py-3">
                      <h2 className="text-sm font-semibold text-ink">
                        {clashes.length === 0 ? "No clashes" : plural(clashes.length, "clash", "clashes")}
                      </h2>
                      {clashes.length === 0 ? (
                        <p className="mt-1 text-sm text-ink-3">No two of these courses meet at overlapping times.</p>
                      ) : (
                        <ul className="mt-2 space-y-1 text-sm">
                          {clashes.map((c) => (
                            <li key={`${c.a}-${c.b}`} className="flex items-center gap-2 text-warning-ink">
                              <Icon name="alert" className="size-4" />
                              <span><span className="font-medium">{c.a}</span> and <span className="font-medium">{c.b}</span> overlap on {c.day} {c.start}–{c.end}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {withoutSlots.length > 0 ? (
                        <p className="mt-3 text-sm text-ink-3">
                          <span className="font-medium text-ink-2">Not shown (no time):</span> {withoutSlots.map((c) => c.courseCode).join(", ")}
                        </p>
                      ) : null}
                    </div>
                  </Card>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <CourseFormDialog open={dialog.open} onClose={closeDialog} course={dialog.course} semesterId={semesterId} groups={groups} isAdmin={isAdmin} />
    </>
  );
}
