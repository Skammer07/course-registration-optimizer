import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getCourseDemand, getStudent, listCourses, listStudentPreferences } from "../../api/data.js";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { Alert, ErrorAlert } from "../../components/ui/Alert.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Card, CardBody, CardHeader } from "../../components/ui/Card.jsx";
import { EmptyState, PageHeader, Skeleton } from "../../components/ui/Misc.jsx";
import { PageSpinner } from "../../components/ui/Spinner.jsx";
import { StudentFormDialog } from "../../features/data/StudentFormDialog.jsx";
import { formatFixed, formatInt, ordinal, plural } from "../../lib/format.js";
import { useDocumentTitle, useQueryParams } from "../../lib/hooks.js";
import { findClashes, formatSlot } from "../../lib/timetable.js";

function Fact({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

function ListStatus({ status }) {
  return status === "submitted" ? (
    <Badge tone="good" icon="check">Submitted</Badge>
  ) : (
    <Badge tone="warning" icon="edit">Draft, not submitted</Badge>
  );
}

/** One ranked list: choice number, course, seats, how many others ranked it, when it meets. */
function RankedList({ preference, courseByCode, demandByCode }) {
  const ranked = (preference.rankedCourseIds ?? []).map((c, i) => {
    const full = courseByCode.get(c.courseCode) ?? c;
    return { rank: i + 1, ...full, ranked: demandByCode.get(c.courseCode)?.ranked };
  });
  const clashes = findClashes(ranked);

  return (
    <Card>
      <CardHeader
        title={`Group ${preference.electiveGroup}`}
        description={`${plural(ranked.length, "course")} ranked, best first`}
        actions={<ListStatus status={preference.status} />}
      />
      <CardBody className="space-y-3">
        {clashes.length > 0 ? (
          <Alert tone="warning" title="Some choices overlap in time">
            {clashes.map((c) => `${c.a} and ${c.b} on ${c.day} ${c.start}–${c.end}`).join("; ")}. The optimizer can avoid giving the student both when the timetable check is on.
          </Alert>
        ) : null}
        <ol className="divide-y divide-line rounded-lg border border-line">
          {ranked.map((c) => (
            <li key={c.courseCode} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3">
              <span className="tabular flex size-7 shrink-0 items-center justify-center rounded-full bg-wash text-sm font-semibold text-ink-2" aria-label={`${ordinal(c.rank)} choice`}>
                {c.rank}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{c.title}</p>
                <p className="text-xs text-ink-3">
                  {c.courseCode}
                  {c.capacity != null ? ` · ${plural(c.capacity, "seat")}` : ""}
                  {c.ranked != null ? ` · ranked by ${formatInt(c.ranked)}` : ""}
                </p>
              </div>
              <ul className="flex flex-wrap gap-1">
                {(c.timetableSlots ?? []).length === 0 ? (
                  <li className="text-xs text-ink-3">No fixed time</li>
                ) : (
                  c.timetableSlots.map((s, i) => <li key={i} className="tabular rounded-md bg-wash px-1.5 py-0.5 text-xs text-ink-2">{formatSlot(s)}</li>)
                )}
              </ul>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}

export function StudentDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const isAdmin = user.role === "admin";
  const [params] = useQueryParams();
  const [editing, setEditing] = useState(false);

  const student = useQuery({ queryKey: ["data", "student", id], queryFn: () => getStudent(id), retry: false });
  // the semester the list was opened from, else the student's own
  const semesterId = params.get("semester") || student.data?.semesterId || "";
  useDocumentTitle(student.data ? student.data.name : "Student");

  const lists = useQuery({
    queryKey: ["data", "student-lists", id, semesterId],
    queryFn: () => listStudentPreferences({ student: id, semesterId }),
    enabled: Boolean(semesterId),
  });
  const courses = useQuery({
    queryKey: ["data", "courses", semesterId],
    queryFn: () => listCourses({ semesterId, limit: 200 }),
    enabled: Boolean(semesterId),
  });
  const demand = useQuery({
    queryKey: ["data", "demand", semesterId],
    queryFn: () => getCourseDemand(semesterId),
    enabled: Boolean(semesterId),
    retry: false,
  });

  const back = { to: semesterId ? `/data/students?semester=${encodeURIComponent(semesterId)}` : "/data/students", label: "All students" };

  if (student.isPending) return <PageSpinner label="Loading student" />;
  if (student.error) {
    return (
      <>
        <PageHeader title="Student" back={back} />
        <ErrorAlert error={student.error} />
      </>
    );
  }

  const s = student.data;
  const courseByCode = new Map((courses.data?.courses ?? []).map((c) => [c.courseCode, c]));
  const demandByCode = new Map((demand.data?.courses ?? []).map((c) => [c.courseCode, c]));
  const preferences = [...(lists.data ?? [])].sort((a, b) => String(a.electiveGroup).localeCompare(String(b.electiveGroup)));

  return (
    <>
      <PageHeader
        title={s.name}
        back={back}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {s.studentId}
            {s.isActive === false ? <Badge tone="neutral" icon="ban">Inactive</Badge> : null}
          </span>
        }
        actions={<Button icon="edit" onClick={() => setEditing(true)}>Edit student</Button>}
      />

      <div className="space-y-4">
        <Card>
          <CardBody>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Fact label="CGPA"><span className="tabular text-lg font-semibold">{formatFixed(s.cgpa, 2)}</span></Fact>
              <Fact label="Department">{s.department || <span className="text-ink-3">Not set</span>}</Fact>
              <Fact label="Semester">{s.semesterId || <span className="text-ink-3">Not set</span>}</Fact>
              <Fact label="Elective groups">
                {s.electiveGroups?.length ? s.electiveGroups.join(", ") : <span className="text-ink-3">Every group of the semester</span>}
              </Fact>
            </dl>
          </CardBody>
        </Card>

        <h2 className="pt-2 text-lg font-semibold">Preference lists{semesterId ? <span className="text-ink-3"> · {semesterId}</span> : null}</h2>

        {!semesterId ? (
          <Card><EmptyState icon="list" title="No semester to show" description="Open this student from the Students list to see their lists for a semester." /></Card>
        ) : lists.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : lists.error ? (
          <ErrorAlert error={lists.error} />
        ) : preferences.length === 0 ? (
          <Card>
            <EmptyState icon="list" title="No preference list yet" description="This student has not saved a list for this semester." />
          </Card>
        ) : (
          <div className="space-y-4">
            {preferences.map((p) => (
              <RankedList key={p._id} preference={p} courseByCode={courseByCode} demandByCode={demandByCode} />
            ))}
          </div>
        )}
      </div>

      <StudentFormDialog open={editing} onClose={() => setEditing(false)} student={s} semesterId={s.semesterId} isAdmin={isAdmin} />
    </>
  );
}
