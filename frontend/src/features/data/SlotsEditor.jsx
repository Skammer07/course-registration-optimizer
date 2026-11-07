import { Button } from "../../components/ui/Button.jsx";
import { inputClass, selectClass } from "../../components/ui/Fields.jsx";
import { Icon } from "../../components/ui/Icon.jsx";
import { cn } from "../../components/ui/cn.js";
import { WEEKDAYS } from "../../lib/timetable.js";
import { NEW_SLOT } from "./courseForm.js";

/** Add, change and remove a course's weekly time slots. */
export function SlotsEditor({ slots, onChange, errors = {} }) {
  const set = (index, patch) => onChange(slots.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const remove = (index) => onChange(slots.filter((_, i) => i !== index));

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-ink">Weekly timetable</legend>
      <p className="text-xs text-ink-3">
        When the course meets. Leave empty if it has no fixed time. If some courses of a semester have times and others do not, the
        timetable clash check cannot be used for runs.
      </p>

      {slots.length === 0 ? <p className="rounded-lg bg-wash px-3 py-2 text-sm text-ink-3">No time slots.</p> : null}

      <ul className="space-y-2">
        {slots.map((slot, i) => (
          <li key={i}>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label={`Slot ${i + 1} day`} value={slot.day} onChange={(e) => set(i, { day: e.target.value })} className={cn(selectClass, "h-9 w-36")}>
                {WEEKDAYS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <input aria-label={`Slot ${i + 1} start`} type="time" value={slot.start} onChange={(e) => set(i, { start: e.target.value })} className={cn(inputClass, "h-9 w-32")} />
              <span aria-hidden="true" className="text-ink-3">to</span>
              <input aria-label={`Slot ${i + 1} end`} type="time" value={slot.end} onChange={(e) => set(i, { end: e.target.value })} className={cn(inputClass, "h-9 w-32")} />
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove slot ${i + 1}`}
                className="rounded-md p-2 text-ink-3 hover:bg-wash hover:text-critical-ink"
              >
                <Icon name="trash" className="size-4" />
              </button>
            </div>
            {errors[i] ? <p className="mt-1 text-xs font-medium text-critical-ink">{errors[i]}</p> : null}
          </li>
        ))}
      </ul>

      <Button size="sm" icon="plus" onClick={() => onChange([...slots, { ...NEW_SLOT }])}>
        Add a time slot
      </Button>
    </fieldset>
  );
}
