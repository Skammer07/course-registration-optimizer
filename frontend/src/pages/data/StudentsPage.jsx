import { useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getPreferenceOverview } from "../../api/data.js";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { ErrorAlert } from "../../components/ui/Alert.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Card } from "../../components/ui/Card.jsx";
import { FilterSelect, inputClass } from "../../components/ui/Fields.jsx";
import { Icon } from "../../components/ui/Icon.jsx";
import { EmptyState, PageHeader, TableSkeleton, tableClass, tdClass, thClass } from "../../components/ui/Misc.jsx";
import { Pagination } from "../../components/ui/Pagination.jsx";
import { StatRow, StatTile } from "../../components/ui/StatTile.jsx";
import { cn } from "../../components/ui/cn.js";
import { StudentFormDialog } from "../../features/data/StudentFormDialog.jsx";
import { NoSemester, SemesterSelect, useSelectedSemester } from "../../features/semesters/SemesterSelect.jsx";
import { formatFixed, formatInt } from "../../lib/format.js";
import { useDebounced, useDocumentTitle, useQueryParams } from "../../lib/hooks.js";

const PAGE_SIZE = 25;

const STATUS_FILTERS = [
  { value: "", label: "Any progress" },
  { value: "complete", label: "Submitted everything" },
  { value: "incomplete", label: "Partly done" },
  { value: "none", label: "Not started" },
];

/** A student's overall progress, in words and an icon (never colour alone). */
export function ProgressBadge({ status }) {
  if (status === "complete") return <Badge tone="good" icon="check">Submitted</Badge>;
  if (status === "incomplete") return <Badge tone="warning" icon="clock">Partly done</Badge>;
  return <Badge tone="neutral" icon="dot">Not started</Badge>;
}

/** One elective group's list state for a student. */
export function GroupBadge({ group, info }) {
  if (info.status === "na") return <span className="text-xs text-ink-3" title="This group is not one of the student's electives">{group}: –</span>;
  const state = {
    submitted: { tone: "good", icon: "check", text: `${info.count} ranked` },
    draft: { tone: "warning", icon: "edit", text: "Draft" },
    missing: { tone: "neutral", icon: "dot", text: "Missing" },
  }[info.status] ?? { tone: "neutral", icon: "dot", text: info.status };
  return (
    <Badge tone={state.tone} icon={state.icon} className="whitespace-nowrap">
      {group} · {state.text}
    </Badge>
  );
}

export function StudentsPage() {
  useDocumentTitle("Students");
  const { user } = useAuth();
  const isAdmin = user.role === "admin";
  const { semesterId, setSemester, overview } = useSelectedSemester();
  const [params, update] = useQueryParams();

  const status = params.get("status") ?? "";
  const department = params.get("department") ?? "";
  const showInactive = params.get("inactive") === "1";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [searchText, setSearchText] = useState(params.get("search") ?? "");
  const search = useDebounced(searchText.trim(), 300);
  const [dialog, setDialog] = useState({ open: false, student: null });

  const query = useQuery({
    queryKey: ["data", "students", semesterId, { search, department, status, showInactive, page }],
    queryFn: () =>
      getPreferenceOverview({
        semesterId,
        search: search || undefined,
        department: department || undefined,
        status: status || undefined,
        includeInactive: showInactive || undefined,
        page,
        limit: PAGE_SIZE,
      }),
    enabled: Boolean(semesterId),
    placeholderData: keepPreviousData,
  });

  const data = query.data;
  const summary = data?.summary;
  const filtered = Boolean(search || department || status || showInactive);
  const groups = data?.groups ?? [];

  return (
    <>
      <PageHeader
        title="Students"
        subtitle="Who is in the semester and how far each has got with their preference lists."
        actions={
          semesterId ? <Button variant="primary" icon="plus" onClick={() => setDialog({ open: true, student: null })}>Add student</Button> : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SemesterSelect semesterId={semesterId} setSemester={setSemester} overview={overview} />
        {semesterId ? (
          <>
            <label className="relative block">
              <span className="sr-only">Search students</span>
              <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
              <input
                type="search"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onBlur={() => update({ search: search || undefined })}
                placeholder="Search name or ID"
                aria-label="Search students"
                className={cn(inputClass, "h-9 w-56 pl-8")}
              />
            </label>
            <FilterSelect label="Department" value={department} onChange={(e) => update({ department: e.target.value })}>
              <option value="">All departments</option>
              {(data?.departments ?? []).map((d) => <option key={d} value={d}>{d}</option>)}
              {department && !(data?.departments ?? []).includes(department) ? <option value={department}>{department}</option> : null}
            </FilterSelect>
            <FilterSelect label="Progress" value={status} onChange={(e) => update({ status: e.target.value })}>
              {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </FilterSelect>
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
      ) : query.error && !data ? (
        <ErrorAlert error={query.error} />
      ) : (
        <div className="space-y-4">
          <StatRow label="Preference progress">
            <StatTile label="Students" value={summary ? formatInt(summary.students) : "–"} hint="Active students in this semester" />
            <StatTile
              label="Submitted everything"
              value={summary ? formatInt(summary.complete) : "–"}
              tone="good"
              hint={summary ? `${formatFixed(summary.students ? (summary.complete / summary.students) * 100 : 0, 0)}% of students` : undefined}
            />
            <StatTile label="Partly done" value={summary ? formatInt(summary.incomplete) : "–"} tone={summary?.incomplete ? "warning" : "neutral"} hint="Some lists missing or still drafts" />
            <StatTile label="Not started" value={summary ? formatInt(summary.none) : "–"} hint="No list saved yet" />
          </StatRow>

          {summary && groups.length > 0 ? (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
              <span className="font-medium text-ink">Submitted per group:</span>
              {groups.map((g) => {
                const c = summary.perGroup?.[g] ?? { submitted: 0, draft: 0, missing: 0 };
                return (
                  <span key={g} className="tabular">{g}: {formatInt(c.submitted)} of {formatInt(c.submitted + c.draft + c.missing)}</span>
                );
              })}
            </p>
          ) : null}

          <Card className="overflow-hidden">
            {query.isPending ? (
              <TableSkeleton />
            ) : data.students.length === 0 ? (
              <EmptyState
                icon="user"
                title={filtered ? "No students match these filters" : "This semester has no students yet"}
                description={filtered ? "Try a different search or progress filter." : "Add a student, or import a students CSV."}
                action={!filtered ? <Button variant="primary" icon="plus" onClick={() => setDialog({ open: true, student: null })}>Add student</Button> : null}
              />
            ) : (
              <div className={cn("overflow-x-auto transition-opacity", query.isPlaceholderData && "opacity-60")}>
                <table className={tableClass}>
                  <caption className="sr-only">Students of {semesterId} and their preference lists</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={thClass}>Student</th>
                      <th scope="col" className={thClass}>Department</th>
                      <th scope="col" className={cn(thClass, "text-right")}>CGPA</th>
                      <th scope="col" className={thClass}>Progress</th>
                      <th scope="col" className={thClass}>Lists by group</th>
                      <th scope="col" className={thClass}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.students.map((s) => (
                      <tr key={s._id} className={cn("transition-colors hover:bg-wash/60", s.isActive === false && "text-ink-3")}>
                        <td className={tdClass}>
                          <Link to={`/data/students/${s._id}?semester=${encodeURIComponent(semesterId)}`} className="font-medium text-ink hover:text-accent-ink">{s.name}</Link>
                          <p className="text-xs text-ink-3">{s.studentId}</p>
                          {s.isActive === false ? <Badge tone="neutral" icon="ban" className="mt-1">Inactive</Badge> : null}
                        </td>
                        <td className={tdClass}>{s.department || <span className="text-ink-3">–</span>}</td>
                        <td className={cn(tdClass, "tabular text-right")}>{formatFixed(s.cgpa, 2)}</td>
                        <td className={tdClass}><ProgressBadge status={s.status} /></td>
                        <td className={tdClass}>
                          <div className="flex flex-wrap gap-1">
                            {groups.map((g) => <GroupBadge key={g} group={g} info={s.groups[g] ?? { status: "na", count: 0 }} />)}
                          </div>
                        </td>
                        <td className={cn(tdClass, "text-right")}>
                          <Button size="sm" variant="ghost" icon="edit" onClick={() => setDialog({ open: true, student: s })} aria-label={`Edit ${s.studentId}`}>Edit</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {data ? (
            <Pagination page={data.page} limit={data.limit} total={data.total} totalPages={data.totalPages} onPage={(p) => update({ page: p === 1 ? undefined : p })} noun={data.total === 1 ? "student" : "students"} />
          ) : null}
        </div>
      )}

      <StudentFormDialog open={dialog.open} onClose={() => setDialog((d) => ({ ...d, open: false }))} student={dialog.student} semesterId={semesterId} isAdmin={isAdmin} />
    </>
  );
}
