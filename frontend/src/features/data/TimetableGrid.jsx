import { Icon } from "../../components/ui/Icon.jsx";
import { cn } from "../../components/ui/cn.js";
import { SHORT_DAY, buildWeekGrid, clashingCodes, findClashes } from "../../lib/timetable.js";

const ROW_HEIGHT = 60; // px per hour
const GUTTER = "3.5rem";

/**
 * The week at a glance. Courses that meet at overlapping times sit side by side and are marked,
 * so a clash is visible without comparing times by eye. The same slots are listed in the table
 * view of the courses, so nothing here is visual-only.
 */
export function TimetableGrid({ courses, onSelect }) {
  const grid = buildWeekGrid(courses);
  const clashes = findClashes(courses);
  const clashing = clashingCodes(clashes);
  const otherOf = (code) => clashes.filter((c) => c.a === code || c.b === code).map((c) => (c.a === code ? c.b : c.a));

  const hours = Array.from({ length: grid.endHour - grid.startHour }, (_, i) => grid.startHour + i);
  const height = hours.length * ROW_HEIGHT;
  const columns = `${GUTTER} repeat(${grid.days.length}, minmax(7.5rem, 1fr))`;

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <div role="group" aria-label="Weekly timetable" className="min-w-[44rem]">
        <div className="grid border-b border-line bg-surface text-xs font-semibold uppercase tracking-wide text-ink-3" style={{ gridTemplateColumns: columns }}>
          <div />
          {grid.days.map((d) => (
            <div key={d} className="border-l border-line px-2 py-2 text-center">{SHORT_DAY[d]}</div>
          ))}
        </div>

        <div className="grid" style={{ gridTemplateColumns: columns }}>
          <div className="relative" style={{ height }}>
            {hours.map((h, i) => (
              <span key={h} className="tabular absolute right-2 -translate-y-1/2 text-xs text-ink-3" style={{ top: i * ROW_HEIGHT }}>
                {i === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </span>
            ))}
          </div>

          {grid.days.map((day) => (
            <div key={day} className="relative border-l border-line" style={{ height }}>
              {hours.map((h, i) => (
                <div key={h} className="absolute inset-x-0 border-t border-line" style={{ top: i * ROW_HEIGHT }} />
              ))}
              {grid.blocksByDay[day].map((b) => {
                const isClash = clashing.has(b.courseCode);
                const others = otherOf(b.courseCode);
                const label = `${b.courseCode}, ${day} ${b.slot.start} to ${b.slot.end}${isClash ? `, overlaps with ${others.join(", ")}` : ""}`;
                return (
                  <button
                    key={`${b.courseCode}-${b.start}`}
                    type="button"
                    onClick={() => onSelect?.(b.courseCode)}
                    aria-label={label}
                    title={`${b.title}\n${b.slot.start}–${b.slot.end}${isClash ? `\nOverlaps with ${others.join(", ")}` : ""}`}
                    className={cn(
                      "absolute overflow-hidden rounded-md border px-1.5 py-1 text-left text-xs leading-tight transition-shadow hover:shadow-card",
                      isClash
                        ? "border-[#f1d78e] bg-warning-soft text-warning-ink"
                        : "border-accent-line bg-accent-soft text-accent-ink"
                    )}
                    style={{
                      top: ((b.start - grid.startHour * 60) / 60) * ROW_HEIGHT + 1,
                      height: ((b.end - b.start) / 60) * ROW_HEIGHT - 2,
                      left: `calc(${(b.lane / b.lanes) * 100}% + 2px)`,
                      width: `calc(${100 / b.lanes}% - 4px)`,
                    }}
                  >
                    <span className="flex items-center gap-1 font-semibold">
                      {isClash ? <Icon name="alert" className="size-3" /> : null}
                      <span className="truncate">{b.courseCode}</span>
                    </span>
                    <span className="tabular block truncate opacity-80">{b.slot.start}–{b.slot.end}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
