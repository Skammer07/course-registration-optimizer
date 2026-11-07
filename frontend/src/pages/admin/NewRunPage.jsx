import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as allocations from "../../api/allocations.js";
import { Alert, ErrorAlert } from "../../components/ui/Alert.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Card, CardBody, CardHeader } from "../../components/ui/Card.jsx";
import { Field, Segmented, Switch, TextField } from "../../components/ui/Fields.jsx";
import { PageHeader } from "../../components/ui/Misc.jsx";
import { Spinner } from "../../components/ui/Spinner.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { describeError } from "../../lib/errors.js";
import { formatClock } from "../../lib/format.js";
import { useDocumentTitle, useElapsedSeconds } from "../../lib/hooks.js";
import { rememberSemester } from "../../lib/storage.js";
import { SemesterPicker } from "../../features/semesters/SemesterPicker.jsx";
import {
  DEFAULT_RUN_FORM, buildRunRequest, includesOptimizer, pickRunningRun, usesBaselineSettings, validateRunForm,
} from "../../features/runs/runRequest.js";

const MODES = [
  { value: "both", label: "Compare both" },
  { value: "baseline", label: "Baseline only" },
  { value: "optimized", label: "Optimized only" },
];

const MODE_HELP = {
  both: "Runs both algorithms on exactly the same data so the results can be compared side by side.",
  baseline: "Merit seats by CGPA (students served in CGPA order), then a random lottery for the remaining quota.",
  optimized: "Maximizes the number of assignments, then minimizes preference cost. By default it is held to the baseline's result (no student ends worse) and uses CGPA to decide who gets the better choices among equal results.",
};

function RunningCard({ form, seconds, onCancel, cancelling, cancelNote }) {
  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-4 py-10 text-center">
        <Spinner className="size-9 text-accent" label="Run in progress" />
        <div>
          <h2 className="text-lg font-semibold">Running the allocation…</h2>
          <p className="mt-1 text-sm text-ink-3">
            Semester <span className="font-medium text-ink">{form.semesterId}</span> ·{" "}
            <span className="tabular font-medium text-ink">{formatClock(seconds)}</span> elapsed
          </p>
        </div>
        <p className="max-w-md text-sm text-ink-3 text-pretty">
          Most runs finish in a second or two. With the timetable check on, large datasets can take up to a minute; a
          run that goes over the time limit is stopped and recorded as failed.
        </p>
        {cancelNote ? <p className="text-sm text-warning-ink">{cancelNote}</p> : null}
        <Button icon="ban" onClick={onCancel} loading={cancelling}>
          Cancel run
        </Button>
      </CardBody>
    </Card>
  );
}

export function NewRunPage() {
  useDocumentTitle("New run");
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState(DEFAULT_RUN_FORM);
  const [touched, setTouched] = useState(false);
  const [cancelNote, setCancelNote] = useState("");
  const [cancelling, setCancelling] = useState(false);

  const errors = validateRunForm(form);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const shown = (key) => (touched ? errors[key] : undefined);

  const start = useMutation({
    mutationFn: ({ kind, body }) => (kind === "compare" ? allocations.compareRun(body) : allocations.runOne(body)),
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      queryClient.invalidateQueries({ queryKey: ["semesters"] });
      rememberSemester(run.semesterId); // next time this semester is preselected
      toast.success("Run completed", `Semester ${run.semesterId}`);
      navigate(`/runs/${run._id}`);
    },
  });
  const running = start.isPending;
  const seconds = useElapsedSeconds(running);

  const submit = (event) => {
    event.preventDefault();
    setTouched(true);
    setCancelNote("");
    if (Object.keys(errors).length > 0) return;
    start.mutate(buildRunRequest(form));
  };

  // The start request only answers when the run is over, so the id of the running run is
  // looked up from the run list to be able to cancel it.
  const cancel = async () => {
    setCancelling(true);
    try {
      const { runs } = await allocations.listRuns({ status: "running", semesterId: form.semesterId.trim(), limit: 10 });
      const target = pickRunningRun(runs, form.semesterId.trim());
      if (!target) {
        setCancelNote("The run is already finishing; it can no longer be cancelled.");
      } else {
        await allocations.cancelRun(target._id);
        setCancelNote("Cancelling…");
      }
    } catch (error) {
      setCancelNote(describeError(error).message);
    } finally {
      setCancelling(false);
    }
  };

  const error = start.error;
  const wasCancelled = error?.code === "ALLOCATION_CANCELLED";

  return (
    <>
      <PageHeader title="New allocation run" subtitle="Choose a semester and what to run. Data is read from the database." back={{ to: "/runs", label: "All runs" }} />

      {running ? (
        <RunningCard form={form} seconds={seconds} onCancel={cancel} cancelling={cancelling} cancelNote={cancelNote} />
      ) : (
        <form onSubmit={submit} noValidate className="space-y-6">
          {wasCancelled ? (
            <Alert tone="info" title="The run was cancelled">Nothing was saved. You can change the settings and start again.</Alert>
          ) : (
            <ErrorAlert error={error} />
          )}

          <Card>
            <CardHeader title="What to run" />
            <CardBody className="space-y-5">
              <SemesterPicker value={form.semesterId} onChange={(semesterId) => set({ semesterId })} error={shown("semesterId")} />

              <div className="space-y-2">
                <p className="text-sm font-medium text-ink">Algorithms</p>
                <Segmented label="Algorithms" value={form.mode} onChange={(mode) => set({ mode })} options={MODES} />
                <p className="text-sm text-ink-3">{MODE_HELP[form.mode]}</p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Settings" />
            <CardBody className="space-y-5">
              <TextField
                label="Maximum courses per student"
                type="number"
                min={1}
                max={10}
                value={form.maxCourses}
                onChange={(e) => set({ maxCourses: e.target.value })}
                error={shown("maxCourses")}
                className="max-w-xs"
              />

              {includesOptimizer(form.mode) ? (
                <>
                  <Switch
                    label="Never leave a student worse off than the baseline"
                    description="Every student keeps the baseline's result in each group or gets a better one, so high-CGPA students keep what they would have had. The optimizer then uses the same seat split and seed as the baseline. Recommended."
                    checked={form.protectBaseline}
                    onChange={(protectBaseline) => set({ protectBaseline })}
                  />
                  <Switch
                    label="Use CGPA to decide who gets the better choices"
                    description="Among results that cost the same, students with a higher CGPA get the better choices."
                    checked={form.cgpaPriority}
                    onChange={(cgpaPriority) => set({ cgpaPriority })}
                  />
                </>
              ) : null}

              {usesBaselineSettings(form) ? (
                <>
                  <Field
                    label={`Baseline seat split: ${form.meritPercent}% by CGPA merit · ${100 - Number(form.meritPercent || 0)}% by random lottery`}
                    error={shown("meritPercent")}
                    hint="Share of each course's seats given by CGPA. The rest is drawn by lottery. Unused merit seats are not moved to the lottery."
                  >
                    {(a11y) => (
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={form.meritPercent}
                        onChange={(e) => set({ meritPercent: Number(e.target.value) })}
                        className="w-full max-w-md accent-[var(--color-accent)]"
                        {...a11y}
                      />
                    )}
                  </Field>
                  <TextField
                    label="Lottery seed (optional)"
                    inputMode="numeric"
                    value={form.seed}
                    onChange={(e) => set({ seed: e.target.value })}
                    error={shown("seed")}
                    hint="Leave empty for a fresh random draw. Enter a number to repeat exactly the same lottery later."
                    className="max-w-xs"
                  />
                </>
              ) : null}

              <Switch
                label="Check timetable clashes"
                description="No student is given two courses that overlap in time."
                checked={form.includeTimetable}
                onChange={(includeTimetable) => set({ includeTimetable })}
              />
              {form.includeTimetable && includesOptimizer(form.mode) ? (
                <Alert tone="info" title="The optimizer searches for the best clash-free result">
                  On large datasets the search stops after about 12 seconds and keeps the best result it found; the run page then
                  says it may not be the best possible. With the optimizer held to the baseline it is usually much faster.
                </Alert>
              ) : null}
            </CardBody>
          </Card>

          <div className="flex items-center justify-end gap-3">
            <Button type="submit" variant="primary" size="lg" icon="play">
              Run allocation
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
