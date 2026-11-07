import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as allocations from "../../api/allocations.js";
import { useAuth } from "../../auth/AuthProvider.jsx";
import { Alert, ErrorAlert } from "../../components/ui/Alert.jsx";
import { AlgorithmTag, StatusBadge } from "../../components/ui/Badge.jsx";
import { Button, buttonClass } from "../../components/ui/Button.jsx";
import { Segmented } from "../../components/ui/Fields.jsx";
import { EmptyState, PageHeader, Skeleton } from "../../components/ui/Misc.jsx";
import { Spinner } from "../../components/ui/Spinner.jsx";
import { Tabs, tabId } from "../../components/ui/Tabs.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { ALGORITHMS, ALGORITHM_META } from "../../lib/chartTheme.js";
import { formatDateTime, formatDuration } from "../../lib/format.js";
import { useDocumentTitle } from "../../lib/hooks.js";
import { ComparisonOverview } from "../../features/runs/ComparisonOverview.jsx";
import { CoursesTab } from "../../features/runs/CoursesTab.jsx";
import { DetailsTab } from "../../features/runs/DetailsTab.jsx";
import { StudentsTab } from "../../features/runs/StudentsTab.jsx";
import {
  ConfirmDialog, ExportMenu, PublishDialog, VerifyDialog, presentAlgorithms, publishable,
} from "../../features/runs/RunActions.jsx";

const HAS_RESULTS = ["completed", "publishing", "published"];
const DELETABLE = ["completed", "failed", "cancelled"];

function DetailSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" role="status" aria-label="Loading run">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-5 w-96" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-36" />)}
      </div>
    </div>
  );
}

export function RunDetailPage() {
  const { runId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState(null); // "publish" | "verify" | "delete" | "cancel" | null
  const isAdmin = user.role === "admin";

  const query = useQuery({
    queryKey: ["runs", runId, "summary"],
    queryFn: () => allocations.getRunSummary(runId),
    // follow a run that is still being computed or published
    refetchInterval: (q) => (["running", "publishing"].includes(q.state.data?.run?.status) ? 2500 : false),
  });
  const summary = query.data;
  useDocumentTitle(summary ? `Run · ${summary.run.semesterId}` : "Run");

  const refreshAll = () => queryClient.invalidateQueries({ queryKey: ["runs"] });
  const remove = useMutation({
    mutationFn: () => allocations.deleteRun(runId),
    onSuccess: () => {
      refreshAll();
      toast.success("Run deleted");
      navigate("/runs", { replace: true });
    },
  });
  const cancel = useMutation({
    mutationFn: () => allocations.cancelRun(runId),
    onSuccess: () => {
      refreshAll();
      toast.info("Run cancelled");
      setDialog(null);
    },
  });

  if (query.isPending) return <DetailSkeleton />;
  if (query.error) {
    return query.error.status === 404 ? (
      <EmptyState
        icon="search"
        title="Run not found"
        description="It may have been deleted."
        action={<Link to="/runs" className={buttonClass({ variant: "primary" })}>Back to all runs</Link>}
      />
    ) : (
      <ErrorAlert error={query.error} />
    );
  }

  const { run } = summary;
  const present = presentAlgorithms(summary);
  const hasResults = HAS_RESULTS.includes(run.status) && present.length > 0;

  const requestedTab = params.get("tab");
  const tab = ["overview", "students", "courses", "details"].includes(requestedTab) && (hasResults || ["overview", "details"].includes(requestedTab)) ? requestedTab : "overview";
  const requestedAlg = params.get("alg");
  const algorithm = present.includes(requestedAlg) ? requestedAlg : present.includes(run.selectedAlgorithm) ? run.selectedAlgorithm : present[0];

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const tabs = [
    { value: "overview", label: "Overview" },
    ...(hasResults ? [{ value: "students", label: "Students" }, { value: "courses", label: "Courses" }] : []),
    { value: "details", label: "Details" },
  ];
  const showAlgorithmPicker = hasResults && present.length > 1 && (tab === "students" || tab === "courses");

  const canPublish = isAdmin && run.status === "completed" && publishable(summary).length > 0;

  return (
    <>
      <PageHeader
        back={{ to: "/runs", label: "All runs" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            Run for {run.semesterId}
            <StatusBadge status={run.status} />
          </span>
        }
        subtitle={
          <span>
            Started {formatDateTime(run.createdAt)} · took {formatDuration(run.totalRuntimeMs)}
            {run.randomSeed !== null && run.randomSeed !== undefined ? ` · seed ${run.randomSeed}` : ""} · version {run.algorithmVersion}
            {run.status === "published" && run.selectedAlgorithm ? (
              <> · published: <AlgorithmTag algorithm={run.selectedAlgorithm} long className="font-medium" /></>
            ) : null}
          </span>
        }
        actions={
          <>
            {hasResults ? <ExportMenu summary={summary} /> : null}
            {isAdmin && hasResults ? <Button icon="refresh" onClick={() => setDialog("verify")}>Verify</Button> : null}
            {isAdmin && run.status === "running" ? <Button icon="ban" onClick={() => setDialog("cancel")}>Cancel run</Button> : null}
            {isAdmin && DELETABLE.includes(run.status) ? <Button icon="trash" onClick={() => setDialog("delete")}>Delete</Button> : null}
            {canPublish ? <Button variant="primary" icon="shield" onClick={() => setDialog("publish")}>Publish…</Button> : null}
          </>
        }
      />

      {run.status === "running" || run.status === "publishing" ? (
        <Alert tone="info" title={run.status === "running" ? "This run is still being computed" : "Publishing in progress"} className="mb-4">
          <span className="inline-flex items-center gap-2"><Spinner className="size-3.5" /> This page updates by itself.</span>
        </Alert>
      ) : null}
      {run.status === "failed" ? (
        <Alert tone="critical" title="This run failed" className="mb-4">{run.errorSummary ?? "No details were recorded."}</Alert>
      ) : null}
      {run.status === "cancelled" ? (
        <Alert tone="info" title="This run was cancelled" className="mb-4">No results were stored.</Alert>
      ) : null}

      <Tabs value={tab} onChange={(v) => setParam("tab", v === "overview" ? null : v)} tabs={tabs} label="Run sections" prefix="run" />

      <div role="tabpanel" aria-labelledby={tabId("run", tab)} className="pt-5">
        {showAlgorithmPicker ? (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <span className="text-sm text-ink-3">Showing results of</span>
            <Segmented
              label="Algorithm"
              value={algorithm}
              onChange={(v) => setParam("alg", v)}
              options={ALGORITHMS.filter((a) => present.includes(a)).map((a) => ({
                value: a,
                label: `${ALGORITHM_META[a].label}${run.selectedAlgorithm === a ? " · published" : ""}`,
              }))}
            />
          </div>
        ) : null}

        {tab === "overview" ? (
          hasResults ? (
            <ComparisonOverview summary={summary} />
          ) : (
            <EmptyState icon="info" title="No results to show" description="This run did not produce results. The Details tab explains why." />
          )
        ) : null}
        {tab === "students" ? <StudentsTab runId={runId} algorithm={algorithm} /> : null}
        {tab === "courses" ? <CoursesTab runId={runId} algorithm={algorithm} /> : null}
        {tab === "details" ? <DetailsTab summary={summary} /> : null}
      </div>

      <PublishDialog open={dialog === "publish"} onClose={() => setDialog(null)} summary={summary} />
      <VerifyDialog open={dialog === "verify"} onClose={() => setDialog(null)} summary={summary} />
      <ConfirmDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        title="Delete this run?"
        description="The run and all its stored assignments are removed. Published runs cannot be deleted. This cannot be undone."
        confirmLabel="Delete run"
        onConfirm={() => remove.mutate()}
        busy={remove.isPending}
        error={remove.error}
      />
      <ConfirmDialog
        open={dialog === "cancel"}
        onClose={() => setDialog(null)}
        title="Cancel this run?"
        description="The computation is stopped and nothing is stored."
        confirmLabel="Cancel the run"
        onConfirm={() => cancel.mutate()}
        busy={cancel.isPending}
        error={cancel.error}
      />
    </>
  );
}
