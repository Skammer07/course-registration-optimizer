import { useQuery } from "@tanstack/react-query";
import { getMyCompulsory } from "../../api/data.js";
import { Badge } from "../../components/ui/Badge.jsx";
import { formatSlot } from "../../lib/timetable.js";

/**
 * The signed-in student's own compulsory courses. A failed request just means "show nothing":
 * this is extra information, never a reason to block the page.
 */
export function useMyCompulsory(enabled = true) {
  const query = useQuery({
    queryKey: ["my-compulsory"],
    queryFn: getMyCompulsory,
    enabled,
    retry: false,
  });
  return query.data?.courses ?? [];
}

/** Compulsory courses with their weekly times. They are fixed: nothing to choose or rank. */
export function CompulsoryList({ courses, labelledBy }) {
  return (
    <ul aria-labelledby={labelledBy} className="divide-y divide-line rounded-lg border border-line bg-surface">
      {courses.map((c) => (
        <li key={c.courseCode} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-ink">{c.title}</p>
            <p className="text-xs text-ink-3">{c.courseCode}</p>
          </div>
          <Badge tone="accent">Compulsory</Badge>
          {c.timetableSlots?.length ? (
            <ul className="flex flex-wrap gap-1">
              {c.timetableSlots.map((s, i) => (
                <li key={i} className="tabular rounded-md bg-wash px-1.5 py-0.5 text-xs text-ink-2">{formatSlot(s)}</li>
              ))}
            </ul>
          ) : (
            <span className="text-xs text-ink-3">No fixed time</span>
          )}
        </li>
      ))}
    </ul>
  );
}
