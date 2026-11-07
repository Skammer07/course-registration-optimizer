import { useEffect, useRef, useState } from "react";
import { Alert } from "../../components/ui/Alert.jsx";
import { Field, inputClass, selectClass } from "../../components/ui/Fields.jsx";
import { Skeleton } from "../../components/ui/Misc.jsx";
import { plural } from "../../lib/format.js";
import { readLastSemester } from "../../lib/storage.js";
import { useSemesterOverview } from "./useSemesterOverview.js";

/** "30 students · 8 courses · 60 submitted preference lists · 2 runs so far" */
export function describeSemester(s) {
  const parts = [plural(s.students, "student"), plural(s.courses, "course"), `${plural(s.preferenceLists, "submitted preference list")}`];
  if (s.runs > 0) parts.push(`${plural(s.runs, "run")} so far`);
  return parts.join(" · ");
}

/** What to preselect: the semester used last time, else the only one that has students. */
export function pickInitialSemester(options, remembered) {
  if (remembered && options.some((s) => s.semesterId === remembered)) return remembered;
  const withStudents = options.filter((s) => s.students > 0);
  return withStudents.length === 1 ? withStudents[0].semesterId : "";
}

/** Problems that would make a run fail, said before the admin presses the button. */
export function semesterProblems(s) {
  const problems = [];
  if (s.students === 0) problems.push("It has no active students.");
  if (s.courses === 0) problems.push("It has no active courses.");
  if (s.preferenceLists === 0) problems.push("No preference lists have been submitted yet.");
  return problems;
}

const linkButton = "text-xs text-ink-3 underline underline-offset-2 hover:text-ink";

/**
 * Choose the semester to work on from the ones that exist, instead of typing an id.
 * Falls back to a text box when the list cannot be loaded, is empty, or the admin
 * wants an id that is not in it.
 */
export function SemesterPicker({ value, onChange, error }) {
  const overview = useSemesterOverview();
  const [manual, setManual] = useState(false);
  const preselected = useRef(false);
  const options = overview.data ?? [];

  // once, when the list arrives: preselect so the common case needs no clicking
  useEffect(() => {
    if (preselected.current || !overview.data) return;
    preselected.current = true;
    if (!value) {
      const pick = pickInitialSemester(overview.data, readLastSemester());
      if (pick) onChange(pick);
    }
  }, [overview.data, value, onChange]);

  if (overview.isPending) {
    return (
      <div className="space-y-1.5" role="status" aria-label="Loading semesters">
        <p className="text-sm font-medium text-ink">Semester</p>
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const showList = options.length > 0 && !manual;
  const selected = options.find((s) => s.semesterId === value);
  const problems = selected ? semesterProblems(selected) : [];

  return (
    <div className="space-y-2">
      {showList ? (
        <Field label="Semester" required error={error} hint={selected ? describeSemester(selected) : "Pick the semester whose data you want to allocate."}>
          {(a11y) => (
            <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value)} {...a11y}>
              <option value="">Choose a semester…</option>
              {options.map((s) => (
                <option key={s.semesterId} value={s.semesterId}>
                  {s.semesterId}
                  {s.name ? ` · ${s.name}` : ""}
                  {` (${plural(s.students, "student")})`}
                </option>
              ))}
              {value && !selected ? <option value={value}>{value}</option> : null}
            </select>
          )}
        </Field>
      ) : (
        <Field
          label="Semester"
          required
          error={error}
          hint={
            options.length === 0
              ? "No semesters with data were found. Enter the id used when the students, courses and preferences were entered."
              : "Enter a semester id that is not in the list."
          }
        >
          {(a11y) => (
            <input className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. SEM2026A" autoComplete="off" {...a11y} />
          )}
        </Field>
      )}

      {options.length > 0 ? (
        <button type="button" className={linkButton} onClick={() => setManual((m) => !m)}>
          {manual ? "Choose from the list" : "Enter a different semester id"}
        </button>
      ) : null}

      {problems.length > 0 ? (
        <Alert tone="warning" title={`${selected.semesterId} may not be ready to run`}>
          <ul className="list-disc space-y-0.5 pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </Alert>
      ) : null}
    </div>
  );
}
