import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listCourses, getStudent } from "../../api/data.js";
import { getMyPreferences, saveMyPreference } from "../../api/preferences.js";
import { getSemesterStatus } from "../../api/semesters.js";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { Alert, ErrorAlert } from "../../components/ui/Alert.jsx";
import { Badge } from "../../components/ui/Badge.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Card, CardBody, CardHeader } from "../../components/ui/Card.jsx";
import { inputClass } from "../../components/ui/Fields.jsx";
import { Icon } from "../../components/ui/Icon.jsx";
import { EmptyState, PageHeader, Skeleton } from "../../components/ui/Misc.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { cn } from "../../components/ui/cn.js";
import {
  MAX_CHOICES, addCourse, groupsFor, moveCourse, poolFor, removeCourse, requiredChoices, sameList,
} from "../../features/preferences/ranking.js";
import { formatDateTime, plural } from "../../lib/format.js";
import { useDocumentTitle } from "../../lib/hooks.js";
import { findClashes, formatSlot, overlapsFixed } from "../../lib/timetable.js";
import { CompulsoryList, useMyCompulsory } from "../../features/student/CompulsoryCourses.jsx";
import { StatusBanner } from "./MyResultsPage.jsx";

function SlotList({ course }) {
  const slots = course.timetableSlots ?? [];
  if (slots.length === 0) return <span className="text-xs text-ink-3">No fixed time</span>;
  return (
    <ul className="flex flex-wrap gap-1">
      {slots.map((s, i) => <li key={i} className="tabular rounded-md bg-wash px-1.5 py-0.5 text-xs text-ink-2">{formatSlot(s)}</li>)}
    </ul>
  );
}

/** Tells the student a course meets at the same time as one of their compulsory classes. */
function OverlapBadge({ course, compulsory }) {
  const found = overlapsFixed(course, compulsory);
  if (!found) return null;
  return <Badge tone="warning" icon="alert">Overlaps {found.code}</Badge>;
}

/** Rank the courses of one elective group, best first, then save as a draft or submit. */
function GroupRanking({ group, semesterId, courses, saved, open, compulsory = [] }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const byId = new Map(courses.map((c) => [c._id, c]));
  const savedIds = (saved?.rankedCourseIds ?? []).map((c) => String(c._id ?? c)).filter((id) => byId.has(id));
  const [ranked, setRanked] = useState(savedIds);
  const [search, setSearch] = useState("");

  // pick up what the server holds (first load, or after a save)
  const savedKey = savedIds.join(",");
  useEffect(() => setRanked(savedIds), [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (status) => saveMyPreference({ semesterId, electiveGroup: group, rankedCourseIds: ranked, status }),
    onSuccess: (_, status) => {
      queryClient.invalidateQueries({ queryKey: ["my-preferences"] });
      toast.success(status === "submitted" ? "Preferences submitted" : "Draft saved", `Group ${group}`);
    },
  });

  const editable = open && !save.isPending;
  const rankedCourses = ranked.map((id) => byId.get(id));
  const available = courses
    .filter((c) => !ranked.includes(c._id))
    .filter((c) => {
      const q = search.trim().toLowerCase();
      return !q || c.courseCode.toLowerCase().includes(q) || c.title.toLowerCase().includes(q);
    });
  const clashes = findClashes(rankedCourses);
  const blocked = rankedCourses
    .map((c) => ({ course: c, found: overlapsFixed(c, compulsory) }))
    .filter((x) => x.found);
  const changed = !sameList(ranked, savedIds);
  const state = saved?.status;

  // At most 15 choices; a submitted list must be full (15, or every course when fewer exist).
  const required = requiredChoices(courses.length);
  const full = ranked.length >= MAX_CHOICES;
  const missing = required - ranked.length;
  const canSubmit = ranked.length === required && required > 0;

  return (
    <Card>
      <CardHeader
        title={`Group ${group}`}
        description={`${plural(courses.length, "course")} to choose from. Rank ${required === MAX_CHOICES ? "15" : "all"}, favourite first.`}
        actions={
          state === "submitted" && !changed ? <Badge tone="good" icon="check">Submitted</Badge>
          : state === "draft" && !changed ? <Badge tone="warning" icon="edit">Draft saved, not submitted</Badge>
          : changed ? <Badge tone="warning" icon="edit">Unsaved changes</Badge>
          : <Badge icon="dot">Not started</Badge>
        }
      />
      <CardBody className="space-y-4">
        {save.error ? <ErrorAlert error={save.error} /> : null}

        <div>
          <h3 className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm font-semibold text-ink">
            <span>Your ranking</span>
            <span className={cn("tabular text-xs font-medium", canSubmit ? "text-good-ink" : "text-ink-3")} aria-live="polite">
              {ranked.length} of {required} chosen
            </span>
          </h3>
          {rankedCourses.length === 0 ? (
            <p className="rounded-lg bg-wash px-3 py-3 text-sm text-ink-3">Nothing ranked yet. Add courses from the list below.</p>
          ) : (
            <ol className="divide-y divide-line rounded-lg border border-line">
              {rankedCourses.map((c, i) => (
                <li key={c._id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                  <span className="tabular flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent-ink" aria-label={`Choice ${i + 1}`}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{c.title}</p>
                    <p className="text-xs text-ink-3">{c.courseCode} · {plural(c.capacity, "seat")}</p>
                  </div>
                  <SlotList course={c} />
                  <OverlapBadge course={c} compulsory={compulsory} />
                  {editable ? (
                    <div className="flex items-center">
                      <button type="button" aria-label={`Move ${c.courseCode} up`} disabled={i === 0} onClick={() => setRanked(moveCourse(ranked, i, -1))} className="rounded-md p-1.5 text-ink-2 hover:bg-wash disabled:opacity-30"><Icon name="arrowUp" /></button>
                      <button type="button" aria-label={`Move ${c.courseCode} down`} disabled={i === ranked.length - 1} onClick={() => setRanked(moveCourse(ranked, i, 1))} className="rounded-md p-1.5 text-ink-2 hover:bg-wash disabled:opacity-30"><Icon name="arrowDown" /></button>
                      <button type="button" aria-label={`Remove ${c.courseCode}`} onClick={() => setRanked(removeCourse(ranked, c._id))} className="rounded-md p-1.5 text-ink-3 hover:bg-wash hover:text-critical-ink"><Icon name="x" /></button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>

        {clashes.length > 0 ? (
          <Alert tone="warning" title="Some of your choices meet at the same time">
            {clashes.map((c) => `${c.a} and ${c.b} on ${c.day} ${c.start}–${c.end}`).join("; ")}. You can still rank them, but you can only attend one of each pair.
          </Alert>
        ) : null}

        {blocked.length > 0 ? (
          <Alert tone="warning" title="Some of your choices overlap a compulsory class">
            {blocked.map(({ course, found }) => `${course.courseCode} overlaps ${found.code} on ${found.day} ${found.start}–${found.end}`).join("; ")}.
            You can still rank them, but they will not be allocated to you.
          </Alert>
        ) : null}

        {editable ? (
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">Available courses{full ? " (your list is full)" : ""}</h3>
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" aria-label={`Search group ${group} courses`} className={cn(inputClass, "h-9 w-48")} />
            </div>
            {available.length === 0 ? (
              <p className="rounded-lg bg-wash px-3 py-3 text-sm text-ink-3">{search ? "No course matches your search." : "You have ranked every course."}</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {available.map((c) => (
                  <li key={c._id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink">{c.title}</p>
                      <p className="text-xs text-ink-3">{c.courseCode} · {plural(c.capacity, "seat")}</p>
                    </div>
                    <SlotList course={c} />
                  <OverlapBadge course={c} compulsory={compulsory} />
                    <Button size="sm" icon="plus" disabled={full} onClick={() => setRanked(addCourse(ranked, c._id))} aria-label={`Add ${c.courseCode}`}>Add</Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {editable ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
            <Button onClick={() => save.mutate("draft")} disabled={ranked.length === 0 || !changed && state === "draft"} loading={save.isPending && save.variables === "draft"}>Save draft</Button>
            {!canSubmit && ranked.length > 0 ? (
              <span className="mr-auto text-xs text-ink-3">Choose {missing > 0 ? `${missing} more` : `${-missing} fewer`} to submit ({required} needed).</span>
            ) : null}
            <Button variant="primary" icon="check" onClick={() => save.mutate("submitted")} disabled={!canSubmit || (!changed && state === "submitted")} loading={save.isPending && save.variables === "submitted"}>
              Submit
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

export function MyPreferencesPage() {
  useDocumentTitle("My preferences");
  const { user } = useAuth();

  const student = useQuery({ queryKey: ["my-student", user.student], queryFn: () => getStudent(user.student), enabled: Boolean(user.student) });
  const semesterId = student.data?.semesterId;
  const status = useQuery({ queryKey: ["semester-status", "me"], queryFn: () => getSemesterStatus("me"), retry: false });
  const courses = useQuery({
    queryKey: ["my-courses", semesterId],
    queryFn: () => listCourses({ semesterId, isActive: true, limit: 200 }),
    enabled: Boolean(semesterId),
  });
  const saved = useQuery({ queryKey: ["my-preferences", semesterId], queryFn: () => getMyPreferences(semesterId), enabled: Boolean(semesterId) });
  const compulsory = useMyCompulsory(Boolean(user.student));

  const header = <PageHeader title="My preferences" subtitle="Rank the courses you want, best first. The allocation uses your list." />;

  if (!user.student) {
    return <>{header}<Card><EmptyState icon="user" title="Your account is not linked to a student record" description="Ask your coordinator to link it." /></Card></>;
  }
  if (student.error) return <>{header}<ErrorAlert error={student.error} /></>;
  if (student.isPending || (semesterId && (courses.isPending || saved.isPending))) {
    return <>{header}<div className="space-y-4" role="status" aria-label="Loading"><Skeleton className="h-16 w-full" /><Skeleton className="h-48 w-full" /></div></>;
  }
  if (!semesterId) {
    return <>{header}<Card><EmptyState icon="book" title="You are not registered for a semester" description="Ask your coordinator to set your semester." /></Card></>;
  }
  if (courses.error || saved.error) return <>{header}<ErrorAlert error={courses.error ?? saved.error} /></>;

  const open = status.data?.preferencesOpen === true;
  const groups = groupsFor(student.data, courses.data.courses);
  const byGroup = new Map((saved.data ?? []).map((p) => [p.electiveGroup, p]));

  return (
    <>
      {header}
      <div className="space-y-4">
        <StatusBanner status={status.data} />
        {!open && status.data ? (
          <Alert tone="warning" title="You cannot change your preferences now">
            {status.data.status === "preferences-not-open" && status.data.opensAt ? `They open on ${formatDateTime(status.data.opensAt)}.` : "The preference window is closed. Your saved lists are shown below."}
          </Alert>
        ) : null}

        {compulsory.length > 0 ? (
          <section aria-labelledby="my-compulsory">
            <h2 id="my-compulsory" className="mb-1 text-base font-semibold">Your compulsory classes</h2>
            <p className="mb-2 text-sm text-ink-3">An elective that meets at the same time as one of these cannot be allocated to you.</p>
            <CompulsoryList courses={compulsory} labelledBy="my-compulsory" />
          </section>
        ) : null}

        {groups.length > 1 ? (
          <Alert tone="info" title={`${groups.join(" and ")} are separate priority lists`}>
            Each list has up to {MAX_CHOICES} choices, best first. You may rank the same course in more than one list; you will receive it only once.
          </Alert>
        ) : null}

        {groups.length === 0 ? (
          <Card><EmptyState icon="book" title="No courses to choose from yet" description="Courses have not been added for your semester." /></Card>
        ) : (
          groups.map((g) => (
            <GroupRanking
              key={g}
              group={g}
              semesterId={semesterId}
              courses={poolFor(courses.data.courses, g)}
              saved={byGroup.get(g)}
              open={open}
              compulsory={compulsory}
            />
          ))
        )}
      </div>
    </>
  );
}
