import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as allocations from "../../api/allocations.js";
import { Alert, ErrorAlert } from "../../components/ui/Alert.jsx";
import { AlgorithmTag, Badge } from "../../components/ui/Badge.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Dialog } from "../../components/ui/Dialog.jsx";
import { Icon } from "../../components/ui/Icon.jsx";
import { Spinner } from "../../components/ui/Spinner.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { cn } from "../../components/ui/cn.js";
import { ALGORITHMS } from "../../lib/chartTheme.js";
import { saveBlob } from "../../lib/download.js";
import { formatInt } from "../../lib/format.js";
import { describeError } from "../../lib/errors.js";
import { formatMetric } from "../../lib/metrics.js";
import { ValidationBadge } from "./ComparisonOverview.jsx";

/** Which algorithms of a run exist and (for publishing) pass validation. */
export const presentAlgorithms = (summary) => ALGORITHMS.filter((a) => summary.algorithms[a]?.metrics);
export const publishable = (summary) => presentAlgorithms(summary).filter((a) => summary.algorithms[a].validation?.valid);

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

/** Ask before anything that cannot be undone. Shows the error if the action fails. */
export function ConfirmDialog({ open, onClose, title, description, confirmLabel, tone = "danger", onConfirm, busy, error }) {
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      title={title}
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy} data-autofocus>Keep as is</Button>
          <Button variant={tone} onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
        </>
      }
    >
      <p className="text-sm text-ink-2 text-pretty">{description}</p>
      {error ? <ErrorAlert error={error} className="mt-4" /> : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

export function PublishDialog({ open, onClose, summary }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const options = presentAlgorithms(summary);
  const ok = publishable(summary);
  const [choice, setChoice] = useState(null);

  useEffect(() => {
    if (open) setChoice(ok.length === 1 ? ok[0] : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, summary.run.id]);

  const publish = useMutation({
    mutationFn: () => allocations.publishRun(summary.run.id, choice),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      toast.success("Results published", "Students can now see them, and preferences are closed.");
      onClose();
    },
  });

  return (
    <Dialog
      open={open}
      onClose={publish.isPending ? undefined : onClose}
      dismissible={!publish.isPending}
      title="Publish results"
      description={`Choose which algorithm's results students will see for ${summary.run.semesterId}.`}
      footer={
        <>
          <Button onClick={onClose} disabled={publish.isPending}>Cancel</Button>
          <Button variant="primary" icon="shield" loading={publish.isPending} disabled={!choice} onClick={() => publish.mutate()}>
            {choice ? `Publish ${choice} results` : "Publish"}
          </Button>
        </>
      }
    >
      <div role="radiogroup" aria-label="Algorithm to publish" className="space-y-2">
        {options.map((a) => {
          const side = summary.algorithms[a];
          const valid = side.validation?.valid;
          const selected = choice === a;
          return (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={!valid}
              onClick={() => setChoice(a)}
              className={cn(
                "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                selected ? "border-accent bg-accent-soft" : "border-line hover:bg-wash",
                !valid && "cursor-not-allowed opacity-60"
              )}
            >
              <span className={cn("mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full border", selected ? "border-accent bg-accent text-white" : "border-line-strong")}>
                {selected ? <Icon name="check" className="size-3" strokeWidth={3} /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <AlgorithmTag algorithm={a} long className="font-medium" />
                  <ValidationBadge validation={side.validation} />
                </span>
                <span className="mt-1 block text-sm text-ink-3">
                  {formatMetric("totalAssignments", side.metrics.totalAssignments)} assignments ·{" "}
                  {formatMetric("unallocatedStudents", side.metrics.unallocatedStudents)} students without a course · average rank{" "}
                  {formatMetric("averagePreferenceRank", side.metrics.averagePreferenceRank)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {ok.length === 0 ? (
        <Alert tone="critical" title="Nothing can be published" className="mt-4">
          No algorithm in this run passed validation.
        </Alert>
      ) : (
        <Alert tone="warning" title="This cannot be undone" className="mt-4">
          Students will see these results and preferences close for this semester. Another algorithm cannot be published for this run afterwards;
          start a new run instead.
        </Alert>
      )}
      <ErrorAlert error={publish.error} className="mt-4" />
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Verify (replay)
// ---------------------------------------------------------------------------

const REPLAY_BADGE = {
  true: <Badge tone="good" icon="check">Identical</Badge>,
  false: <Badge tone="critical" icon="alert">Differs</Badge>,
  null: <Badge tone="neutral" icon="info">Cannot be replayed</Badge>,
};

export function VerifyDialog({ open, onClose, summary }) {
  const verify = useMutation({ mutationFn: () => allocations.verifyRun(summary.run.id) });
  const { mutate, reset } = verify;

  useEffect(() => {
    if (open) mutate();
    else reset();
  }, [open, mutate, reset]);

  const result = verify.data;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Verify this run"
      description="Re-runs the algorithms from the stored input (and seed) and compares with what was stored."
      size="lg"
      footer={<Button onClick={onClose} data-autofocus>Close</Button>}
    >
      {verify.isPending ? (
        <div className="flex items-center gap-3 py-6 text-ink-2"><Spinner className="size-5" /> Replaying… this can take a moment.</div>
      ) : null}
      <ErrorAlert error={verify.error} />
      {result ? (
        <div className="space-y-4">
          <Alert tone={result.allMatch ? "good" : "warning"} title={result.allMatch ? "The stored results can be reproduced exactly" : "The replay did not match everywhere"}>
            {result.allMatch
              ? "Same input, same settings and the same algorithm version give the same assignments."
              : "See below. A difference can mean the stored data changed, or that the algorithm version is not the one that made this run."}
          </Alert>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {result.results.map((r) => (
              <li key={r.algorithm} className="space-y-1.5 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <AlgorithmTag algorithm={r.algorithm} long className="font-medium" />
                  {REPLAY_BADGE[String(r.matches)]}
                </div>
                {r.matches === null ? (
                  <p className="text-ink-3">{r.reason}</p>
                ) : (
                  <p className="text-ink-3">
                    {formatInt(r.storedCount)} stored · {formatInt(r.replayedCount)} replayed
                    {r.seed !== null && r.seed !== undefined ? ` · seed ${r.seed}` : ""} · version {r.storedVersion}
                    {r.sameVersion ? "" : ` (now ${r.currentVersion})`}
                  </p>
                )}
                {r.note ? <p className="text-warning-ink">{r.note}</p> : null}
                {[...(r.onlyInStored ?? []), ...(r.onlyInReplay ?? [])].length > 0 ? (
                  <p className="text-ink-2">
                    {formatInt((r.onlyInStored ?? []).length)} only in the stored results · {formatInt((r.onlyInReplay ?? []).length)} only in the replay
                    (first {Math.min(20, (r.onlyInStored ?? []).length)} / {Math.min(20, (r.onlyInReplay ?? []).length)} shown by the API).
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/** CSV download. One algorithm -> a button; two -> a small menu. */
export function ExportMenu({ summary }) {
  const toast = useToast();
  const ref = useRef(null);
  const options = presentAlgorithms(summary);
  const [busy, setBusy] = useState(null);

  const download = async (algorithm) => {
    if (ref.current) ref.current.open = false;
    setBusy(algorithm);
    try {
      const { blob, filename } = await allocations.exportRun(summary.run.id, algorithm);
      saveBlob(blob, filename ?? `allocation-${summary.run.semesterId}-${algorithm}.csv`);
    } catch (error) {
      toast.error("Export failed", describeError(error).message);
    } finally {
      setBusy(null);
    }
  };

  if (options.length === 0) return null;
  if (options.length === 1) {
    return <Button icon="download" loading={Boolean(busy)} onClick={() => download(options[0])}>Export CSV</Button>;
  }
  return (
    <details ref={ref} className="relative">
      <summary
        className={cn(
          "inline-flex h-10 list-none items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium text-ink hover:bg-wash",
          "[&::-webkit-details-marker]:hidden"
        )}
      >
        {busy ? <Spinner /> : <Icon name="download" />}
        Export CSV
        <Icon name="chevronDown" className="size-4" />
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-pop)]">
        {options.map((a) => (
          <button key={a} type="button" onClick={() => download(a)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-wash">
            <AlgorithmTag algorithm={a} long />
          </button>
        ))}
      </div>
    </details>
  );
}
