import { cn } from "../../components/ui/cn.js";
import { ordinal } from "../../lib/format.js";

/** How a course was won, in words: "merit, round 1" / "lottery". Optimizer rows have no phase. */
export function phaseLabel(phase, iteration) {
  if (phase === "merit") return iteration ? `merit, round ${iteration}` : "merit";
  if (phase === "random") return "lottery";
  return null;
}

/** A course a student was given: code and choice rank, with the full story on hover/focus. */
export function CourseChip({ course, differs = false }) {
  const how = phaseLabel(course.phase, course.iteration);
  const choice = `${ordinal(course.preferenceRank)} choice${course.electiveGroup ? ` in ${course.electiveGroup}` : ""}`;
  const title = [course.title, choice, how].filter(Boolean).join(" · ");
  return (
    <span tabIndex={0} title={title} aria-label={title} className={cn("inline-flex items-center gap-1.5 rounded-md bg-wash px-2 py-0.5 text-xs font-medium text-ink", differs && "ring-2 ring-ink-3")}>
      {differs ? <span className="sr-only">Different: </span> : null}
      {course.courseCode}
      {course.electiveGroup ? <span className="text-[0.7rem] font-normal text-ink-3">{course.electiveGroup}</span> : null}
      <span className="rounded bg-surface px-1 text-[0.7rem] font-semibold text-ink-2">{course.preferenceRank}</span>
    </span>
  );
}
