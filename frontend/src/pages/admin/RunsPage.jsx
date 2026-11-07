import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listRuns } from "../../api/allocations.js";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { AlgorithmTag, StatusBadge } from "../../components/ui/Badge.jsx";
import { buttonClass } from "../../components/ui/Button.jsx";
import { Card } from "../../components/ui/Card.jsx";
import { StatRow, StatTile } from "../../components/ui/StatTile.jsx";
import { FilterSelect } from "../../components/ui/Fields.jsx";
import { ErrorAlert } from "../../components/ui/Alert.jsx";
import { EmptyState, PageHeader, TableSkeleton, tableClass, tdClass, thClass } from "../../components/ui/Misc.jsx";
import { Pagination } from "../../components/ui/Pagination.jsx";
import { cn } from "../../components/ui/cn.js";
import { ALGORITHM_META } from "../../lib/chartTheme.js";
import { formatDateTime, formatDuration, formatInt, formatRelative } from "../../lib/format.js";
import { useDocumentTitle } from "../../lib/hooks.js";
import { useSemesterOverview } from "../../features/semesters/useSemesterOverview.js";

const PAGE_SIZE = 15;
const STATUSES = ["running", "completed", "published", "failed", "cancelled"];

/** "34 · 39": assignments made by each algorithm, each beside its colour swatch. */
function ResultCell({ run }) {
  if (run.status === "failed" || run.status === "cancelled") {
    return <span className="line-clamp-1 max-w-56 text-ink-3" title={run.errorSummary ?? ""}>{run.errorSummary ?? "No results"}</span>;
  }
  const parts = (run.algorithmsRun ?? []).map((algorithm) => {
    const metrics = algorithm === "baseline" ? run.baselineMetrics : run.optimizedMetrics;
    return { algorithm, value: metrics?.totalAssignments };
  });
  if (parts.every((p) => p.value === undefined)) return <span className="text-ink-3">–</span>;
  return (
    <span className="tabular inline-flex items-center gap-3" title="Assignments made">
      {parts.map((p) => (
        <span key={p.algorithm} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: ALGORITHM_META[p.algorithm].color }} />
          <span className="sr-only">{ALGORITHM_META[p.algorithm].label}: </span>
          {formatInt(p.value)}
        </span>
      ))}
    </span>
  );
}

/** Three headline numbers above the history (shown only for the unfiltered first page). */
function RunsSummary({ data }) {
  const latest = data.runs[0];
  const running = data.runs.filter((r) => r.status === "running").length;
  const published = data.runs.find((r) => r.status === "published");
  return (
    <StatRow label="Run summary" className="mb-5 lg:grid-cols-3">
      <StatTile label="Total runs" value={formatInt(data.total)} hint="Every run keeps its settings and input" />
      <StatTile
        label="Latest run"
        value={latest ? formatRelative(latest.createdAt) : "–"}
        hint={latest ? `${latest.semesterId}${running ? ` · ${running} still running` : ""}` : undefined}
      />
      <StatTile
        label="Published result"
        value={published ? (ALGORITHM_META[published.selectedAlgorithm]?.label ?? "Published") : "None yet"}
        tone={published ? "good" : "neutral"}
        hint={published ? `${published.semesterId}, visible to students` : "Publish a run to show students their courses"}
      />
    </StatRow>
  );
}

export function RunsPage() {
  useDocumentTitle("Runs");
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const page = Math.max(1, Number(params.get("page")) || 1);
  const filters = {
    semesterId: params.get("semester") ?? "",
    status: params.get("status") ?? "",
    algorithm: params.get("algorithm") ?? "",
  };
  const update = (patch) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries({ page: undefined, ...patch })) {
      if (value === undefined || value === "") next.delete(key);
      else next.set(key, String(value));
    }
    setParams(next, { replace: true });
  };

  const runs = useQuery({
    queryKey: ["runs", "list", { ...filters, page }],
    queryFn: () => listRuns({ ...filters, page, limit: PAGE_SIZE }),
    placeholderData: keepPreviousData,
    // keep an eye on runs that are still going
    refetchInterval: (q) => (q.state.data?.runs?.some((r) => r.status === "running") ? 3000 : false),
  });
  const semesters = useSemesterOverview();

  const data = runs.data;
  const filtered = Boolean(filters.semesterId || filters.status || filters.algorithm);

  return (
    <>
      <PageHeader
        title="Allocation runs"
        subtitle="Every run is stored with its settings so it can be compared, published or replayed."
        actions={
          user.role === "admin" ? (
            <Link to="/runs/new" className={buttonClass({ variant: "primary" })}>New run</Link>
          ) : null
        }
      />

      {data && !filtered && page === 1 && data.total > 0 ? <RunsSummary data={data} /> : null}

      {/* one filter row, above what it filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterSelect label="Semester" value={filters.semesterId} onChange={(e) => update({ semester: e.target.value })}>
          <option value="">All semesters</option>
          {(semesters.data ?? []).map((s) => (
            <option key={s.semesterId} value={s.semesterId}>{s.semesterId}</option>
          ))}
          {filters.semesterId && !(semesters.data ?? []).some((s) => s.semesterId === filters.semesterId) ? (
            <option value={filters.semesterId}>{filters.semesterId}</option>
          ) : null}
        </FilterSelect>
        <FilterSelect label="Status" value={filters.status} onChange={(e) => update({ status: e.target.value })}>
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </FilterSelect>
        <FilterSelect label="Algorithm" value={filters.algorithm} onChange={(e) => update({ algorithm: e.target.value })}>
          <option value="">Any algorithm</option>
          <option value="baseline">Baseline</option>
          <option value="optimized">Optimized</option>
        </FilterSelect>
        {filtered ? (
          <button type="button" className="text-sm text-ink-3 underline underline-offset-2 hover:text-ink" onClick={() => setParams({}, { replace: true })}>
            Clear filters
          </button>
        ) : null}
      </div>

      {runs.error && !data ? <ErrorAlert error={runs.error} /> : null}

      {runs.error && !data ? null : (
        <Card className="overflow-hidden">
          {runs.isPending ? (
            <TableSkeleton />
          ) : data?.runs?.length === 0 ? (
            <EmptyState
              icon="history"
              title={filtered ? "No runs match these filters" : "No runs yet"}
              description={filtered ? "Try different filters." : "Run the allocation to see results and compare the two algorithms."}
              action={
                !filtered && user.role === "admin" ? (
                  <Link to="/runs/new" className={buttonClass({ variant: "primary" })}>Start the first run</Link>
                ) : null
              }
            />
          ) : (
            <div className={cn("overflow-x-auto transition-opacity", runs.isPlaceholderData && "opacity-60")}>
              <table className={tableClass}>
                <caption className="sr-only">Allocation runs, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col" className={thClass}>Started</th>
                    <th scope="col" className={thClass}>Semester</th>
                    <th scope="col" className={thClass}>Algorithms</th>
                    <th scope="col" className={thClass}>Status</th>
                    <th scope="col" className={cn(thClass, "text-right")}>Assignments</th>
                    <th scope="col" className={cn(thClass, "text-right")}>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {data.runs.map((run) => (
                    <tr key={run._id} onClick={() => navigate(`/runs/${run._id}`)} className="cursor-pointer transition-colors hover:bg-wash/60">
                      <td className={tdClass}>
                        <Link to={`/runs/${run._id}`} className="font-medium text-ink hover:text-accent-ink" onClick={(e) => e.stopPropagation()}>
                          {formatRelative(run.createdAt)}
                        </Link>
                        <p className="text-xs text-ink-3">{formatDateTime(run.createdAt)}</p>
                      </td>
                      <td className={tdClass}>{run.semesterId}</td>
                      <td className={tdClass}>
                        <div className="flex flex-col gap-0.5">
                          {(run.algorithmsRun ?? []).map((a) => <AlgorithmTag key={a} algorithm={a} />)}
                        </div>
                      </td>
                      <td className={tdClass}>
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge status={run.status} />
                          {run.status === "published" && run.selectedAlgorithm ? (
                            <span className="text-xs text-ink-3">showing <AlgorithmTag algorithm={run.selectedAlgorithm} className="text-xs" /></span>
                          ) : null}
                        </div>
                      </td>
                      <td className={cn(tdClass, "text-right")}><ResultCell run={run} /></td>
                      <td className={cn(tdClass, "tabular text-right text-ink-2")}>{formatDuration(run.totalRuntimeMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {data ? (
        <Pagination page={data.page} limit={data.limit} total={data.total} totalPages={data.totalPages} onPage={(p) => update({ page: p === 1 ? undefined : p })} noun="runs" />
      ) : null}
    </>
  );
}
