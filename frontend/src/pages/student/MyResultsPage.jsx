import { useQuery } from "@tanstack/react-query";
import { getMyResults } from "../../api/allocations.js";
import { getSemesterStatus } from "../../api/semesters.js";
import { Alert, ErrorAlert } from "../../components/ui/Alert.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Card, CardBody } from "../../components/ui/Card.jsx";
import { StatRow, StatTile } from "../../components/ui/StatTile.jsx";
import { EmptyState, PageHeader, Skeleton } from "../../components/ui/Misc.jsx";
import { formatDate, formatDateTime, ordinal } from "../../lib/format.js";
import { useDocumentTitle } from "../../lib/hooks.js";
import { phaseLabel } from "../../features/runs/CourseChip.jsx";
import { CompulsoryList, useMyCompulsory } from "../../features/student/CompulsoryCourses.jsx";

/** Where the semester stands, in one sentence the student can act on. */
export function StatusBanner({ status }) {
  if (!status) return null;
  switch (status.status) {
    case "preferences-not-open":
      return <Alert tone="info" title="Preferences are not open yet">{status.opensAt ? `They open on ${formatDateTime(status.opensAt)}.` : "Check back soon."}</Alert>;
    case "preferences-open":
      return <Alert tone="info" title="Preferences are open">{status.closesAt ? `You can submit or change them until ${formatDateTime(status.closesAt)}.` : "Your coordinator will announce the deadline."}</Alert>;
    case "allocation-pending":
      return <Alert tone="info" title="Preferences are closed">Results will appear here as soon as the allocation is published.</Alert>;
    case "results-published":
      return <Alert tone="good" title="Results are published">Your allocated courses are shown below.</Alert>;
    default:
      return null;
  }
}

function CourseCard({ assignment }) {
  const { course, preferenceRank, phase } = assignment;
  const how = phaseLabel(phase);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line border-l-4 border-l-accent bg-surface p-4 shadow-card transition-shadow hover:shadow-md">
      <div className="min-w-0">
        <p className="text-base font-semibold text-ink">{course.title}</p>
        <p className="mt-0.5 text-sm text-ink-3">
          {course.courseCode}
          {course.electiveGroup ? ` · elective group ${course.electiveGroup}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent" icon="check">Your {ordinal(preferenceRank)} choice</Badge>
        {how ? <Badge>{how === "lottery" ? "Lottery" : "Merit"}</Badge> : null}
      </div>
    </li>
  );
}

export function MyResultsPage() {
  useDocumentTitle("My results");
  const results = useQuery({ queryKey: ["my-results"], queryFn: getMyResults });
  const status = useQuery({ queryKey: ["semester-status", "me"], queryFn: () => getSemesterStatus("me"), retry: false });
  const compulsory = useMyCompulsory();

  if (results.isPending) {
    return (
      <div className="space-y-4" role="status" aria-label="Loading your results">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (results.error) return <ErrorAlert error={results.error} />;

  const data = results.data;
  const max = data.summary?.maxCoursesPerStudent;

  return (
    <>
      <PageHeader
        title="My results"
        subtitle={`${data.student.name} · ${data.student.studentId}${data.semesterId ? ` · semester ${data.semesterId}` : ""}`}
      />
      <div className="mb-5"><StatusBanner status={status.data} /></div>

      {!data.published ? (
        <Card>
          <EmptyState
            icon="clock"
            title="Your results are not published yet"
            description="Once your administrator publishes the allocation, the courses you were given will appear on this page."
          />
        </Card>
      ) : data.assignments.length === 0 ? (
        <Card>
          <EmptyState
            icon="info"
            title="No course was allocated to you in this round"
            description={`${data.summary?.message ?? ""} Please contact your department coordinator about the next steps.`.trim()}
          />
        </Card>
      ) : (
        <section aria-labelledby="my-courses">
          <StatRow label="Your allocation at a glance" className="mb-6 lg:grid-cols-3">
            <StatTile label="Courses allocated" value={data.assignments.length} hint={max ? `of up to ${max} allowed` : undefined} tone="good" />
            <StatTile
              label="Best choice received"
              value={ordinal(Math.min(...data.assignments.map((a) => a.preferenceRank)))}
              hint="Position in your own preference list"
            />
            <StatTile label="Compulsory classes" value={compulsory.length} hint="Fixed for your department" />
          </StatRow>
          <h2 id="my-courses" className="mb-3 text-base font-semibold">
            Your courses <span className="font-normal text-ink-3">({data.assignments.length}{max ? ` of up to ${max}` : ""})</span>
          </h2>
          <ul className="space-y-3">
            {data.assignments.map((a) => <CourseCard key={a.course.courseCode} assignment={a} />)}
          </ul>
          <Card className="mt-5">
            <CardBody className="text-sm text-ink-3">
              Published on {formatDate(data.run?.publishedAt)}. The “choice” number is the position of the course in your own preference list.
            </CardBody>
          </Card>
        </section>
      )}

      {compulsory.length > 0 ? (
        <section aria-labelledby="my-compulsory" className="mt-8">
          <h2 id="my-compulsory" className="mb-1 text-base font-semibold">
            Your compulsory courses <span className="font-normal text-ink-3">({compulsory.length})</span>
          </h2>
          <p className="mb-3 text-sm text-ink-3">
            These are fixed for your department and are not part of the allocation. The electives you are given never overlap them.
          </p>
          <CompulsoryList courses={compulsory} labelledBy="my-compulsory" />
        </section>
      ) : null}
    </>
  );
}
