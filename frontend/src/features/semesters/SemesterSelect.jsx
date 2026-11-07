import { useEffect } from "react";
import { Link } from "react-router-dom";
import { buttonClass } from "../../components/ui/Button.jsx";
import { FilterSelect } from "../../components/ui/Fields.jsx";
import { EmptyState, Skeleton } from "../../components/ui/Misc.jsx";
import { readLastSemester, rememberSemester } from "../../lib/storage.js";
import { useQueryParams } from "../../lib/hooks.js";
import { pickInitialSemester } from "./SemesterPicker.jsx";
import { useSemesterOverview } from "./useSemesterOverview.js";

/**
 * The semester a data screen is looking at. It lives in the address (?semester=SEM-1), so a link
 * opens the same view; with none given, the last one used (or the only one with students) is
 * picked once the list of semesters arrives.
 */
export function useSelectedSemester() {
  const overview = useSemesterOverview();
  const [params, update] = useQueryParams();
  const semesterId = params.get("semester") ?? "";

  useEffect(() => {
    if (!overview.data || semesterId) return;
    const pick = pickInitialSemester(overview.data, readLastSemester());
    if (pick) update({ semester: pick, page: undefined });
  }, [overview.data, semesterId, update]);

  const setSemester = (id) => {
    if (id) rememberSemester(id);
    update({ semester: id });
  };
  const selected = (overview.data ?? []).find((s) => s.semesterId === semesterId);
  return { semesterId, setSemester, overview, selected };
}

/** A compact "Semester" dropdown for a filter row. */
export function SemesterSelect({ semesterId, setSemester, overview }) {
  const options = overview.data ?? [];
  if (overview.isPending) return <Skeleton className="h-9 w-56" />;
  return (
    <FilterSelect label="Semester" value={semesterId} onChange={(e) => setSemester(e.target.value)} className="min-w-56">
      <option value="">Choose a semester…</option>
      {options.map((s) => (
        <option key={s.semesterId} value={s.semesterId}>
          {s.semesterId}
          {s.name ? ` · ${s.name}` : ""}
        </option>
      ))}
      {semesterId && !options.some((s) => s.semesterId === semesterId) ? <option value={semesterId}>{semesterId}</option> : null}
    </FilterSelect>
  );
}

/** Shown instead of a screen's content until a semester is chosen, or when there is none yet. */
export function NoSemester({ overview, isAdmin }) {
  const none = !overview.isPending && (overview.data ?? []).length === 0;
  return (
    <EmptyState
      icon="book"
      title={none ? "There is no semester data yet" : "Choose a semester"}
      description={
        none
          ? "Import students, courses and preferences from CSV files, or seed demo data, and the semester will appear here."
          : "Pick the semester whose data you want to look at."
      }
      action={
        none && isAdmin ? (
          <Link to="/data/import" className={buttonClass({ variant: "primary" })}>Import data</Link>
        ) : null
      }
    />
  );
}
