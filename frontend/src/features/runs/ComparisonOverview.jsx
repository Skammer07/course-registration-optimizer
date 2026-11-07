import { Link } from "react-router-dom";
import { Alert } from "../../components/ui/Alert.jsx";
import { StatRow, StatTile } from "../../components/ui/StatTile.jsx";
import { AlgorithmTag, Badge } from "../../components/ui/Badge.jsx";
import { buttonClass } from "../../components/ui/Button.jsx";
import { Card, CardBody, CardHeader } from "../../components/ui/Card.jsx";
import { Icon } from "../../components/ui/Icon.jsx";
import { tableClass, tdClass, thClass } from "../../components/ui/Misc.jsx";
import { cn } from "../../components/ui/cn.js";
import { ALGORITHMS, ALGORITHM_META } from "../../lib/chartTheme.js";
import { formatInt } from "../../lib/format.js";
import {
  HEADLINE_KEYS, METRIC_BY_KEY, METRICS, directionOf, formatDifference, formatMetric, metricValue,
} from "../../lib/metrics.js";
import { ChartLegend, MetricsChart } from "./MetricsChart.jsx";

const DIRECTION_STYLE = {
  favorable: { className: "text-good-ink", word: "better for this metric" },
  unfavorable: { className: "text-critical-ink", word: "worse for this metric" },
  neutral: { className: "text-ink-2", word: "no better or worse" },
  none: { className: "text-ink-3", word: "no difference" },
};

/**
 * A difference (optimized minus baseline) with an arrow and a signed number. Colour only
 * repeats what the arrow, the sign and the screen-reader text already say.
 */
export function DeltaText({ metricKey, difference }) {
  const direction = directionOf(metricKey, difference);
  const style = DIRECTION_STYLE[direction];
  const arrow = difference > 0 ? "arrowUp" : difference < 0 ? "arrowDown" : null;
  return (
    <span className={cn("tabular inline-flex items-center gap-1 font-medium", style.className)}>
      {arrow ? <Icon name={arrow} className="size-3.5" strokeWidth={2.25} /> : null}
      {formatDifference(metricKey, difference)}
      <span className="sr-only"> ({style.word})</span>
    </span>
  );
}

export function ValidationBadge({ validation }) {
  if (!validation) return null;
  return validation.valid ? (
    <Badge tone="good" icon="check">Passed validation</Badge>
  ) : (
    <Badge tone="critical" icon="alert">{formatInt(validation.errorCount)} validation error{validation.errorCount === 1 ? "" : "s"}</Badge>
  );
}

function PolicyNotice({ summary }) {
  const { note, warnings } = summary.comparison;
  return (
    <div className="space-y-3">
      <Alert tone="info" title="Two different policies: no winner is declared">
        {note}
      </Alert>
      {warnings?.length ? (
        <Alert tone="warning" title={warnings.length === 1 ? "Heads-up" : `${warnings.length} heads-ups`}>
          <ul className="list-disc space-y-0.5 pl-5">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </Alert>
      ) : null}
    </div>
  );
}

/** Student by student: the proof that the optimizer is better than the baseline, or the places it is not. */
export function BaselineEvidence({ evidence }) {
  if (!evidence) return null;
  const { slots, better, same, worse, gained, topCgpa, others, worstRank, cgpaPriorityViolations: violations, heldToBaseline } = evidence;
  const arrow = (a, b) => `${a ?? "–"} → ${b ?? "–"}`;

  return (
    <Card>
      <CardHeader
        title="Compared with the baseline, student by student"
        description={`${formatInt(slots)} results the baseline gave, judged by where each course stands in that student's own list for that group.`}
      />
      <CardBody className="space-y-4">
        {worse === 0 && heldToBaseline ? (
          <Alert tone="good" title="No student ends worse than under the baseline">
            Every student keeps the baseline's result in each group or gets a better one, including the students with the highest CGPA.
          </Alert>
        ) : worse > 0 ? (
          <Alert tone="warning" title={`${formatInt(worse)} of the baseline's results are worse in the optimized allocation`}>
            {heldToBaseline
              ? "The optimizer was meant to be held to the baseline, so please check this run."
              : "The optimizer was not held to the baseline in this run, so some students end worse than they would have under it."}
          </Alert>
        ) : null}

        <StatRow label="Better, same and worse than the baseline">
          <StatTile label="Better" value={formatInt(better)} tone={better > 0 ? "good" : "neutral"} hint="Ranked higher in their own list" />
          <StatTile label="Same" value={formatInt(same)} hint="The same rank as under the baseline" />
          <StatTile label="Worse" value={formatInt(worse)} tone={worse > 0 ? "critical" : "good"} hint="Ranked lower, or lost the course" />
          <StatTile label="Newly filled" value={formatInt(gained)} hint="Filled where the baseline left a group empty" />
        </StatRow>

        <dl className="divide-y divide-line text-sm">
          <DetailRow label={`Average rank, ${formatInt(topCgpa.students)} students with the highest CGPA`}>{arrow(topCgpa.baselineAverageRank, topCgpa.optimizedAverageRank)}</DetailRow>
          <DetailRow label={`Average rank, the other ${formatInt(others.students)} students`}>{arrow(others.baselineAverageRank, others.optimizedAverageRank)}</DetailRow>
          <DetailRow label="Lowest choice anyone was given (worst rank)">{arrow(worstRank.baseline, worstRank.optimized)}</DetailRow>
          <DetailRow label="CGPA-priority violations">
            {arrow(violations.baseline, violations.optimized)}
            <span className="block text-xs text-ink-3">A student ranked a course above their own and a student with a lower CGPA holds it. The baseline's lottery causes some by design.</span>
          </DetailRow>
        </dl>
        <p className="text-xs text-ink-3">Each pair reads baseline → optimized. Lower is better for every rank and violation count.</p>
      </CardBody>
    </Card>
  );
}

function MetricCompareCard({ metricKey, summary }) {
  const metric = METRIC_BY_KEY[metricKey];
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
      <p className="text-sm text-ink-2" title={metric.help}>{metric.label}</p>
      <dl className="mt-3 space-y-2">
        {ALGORITHMS.map((a) => (
          <div key={a} className="flex items-baseline justify-between gap-3">
            <dt><AlgorithmTag algorithm={a} /></dt>
            <dd className="text-2xl font-semibold text-ink">{formatMetric(metricKey, metricValue(summary.algorithms[a], metricKey))}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2 text-xs text-ink-3">
        <span>Optimized vs baseline</span>
        <DeltaText metricKey={metricKey} difference={summary.comparison.difference?.[metricKey]} />
      </p>
    </div>
  );
}

function ComparisonTable({ summary }) {
  const rows = METRICS.filter((m) => metricValue(summary.algorithms.baseline, m.key) !== undefined || metricValue(summary.algorithms.optimized, m.key) !== undefined);
  return (
    <div className="overflow-x-auto">
      <table className={tableClass}>
        <caption className="sr-only">All metrics for both algorithms. Difference is optimized minus baseline.</caption>
        <thead>
          <tr>
            <th scope="col" className={thClass}>Metric</th>
            <th scope="col" className={cn(thClass, "text-right")}><AlgorithmTag algorithm="baseline" /></th>
            <th scope="col" className={cn(thClass, "text-right")}><AlgorithmTag algorithm="optimized" /></th>
            <th scope="col" className={cn(thClass, "text-right")}>Difference</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.key}>
              <th scope="row" className={cn(tdClass, "font-normal")}>
                <span className="text-ink">{m.label}</span>
                <span className="block text-xs text-ink-3">{m.help}</span>
              </th>
              <td className={cn(tdClass, "tabular text-right text-ink")}>{formatMetric(m.key, metricValue(summary.algorithms.baseline, m.key))}</td>
              <td className={cn(tdClass, "tabular text-right text-ink")}>{formatMetric(m.key, metricValue(summary.algorithms.optimized, m.key))}</td>
              <td className={cn(tdClass, "text-right")}><DeltaText metricKey={m.key} difference={summary.comparison.difference?.[m.key]} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailRow({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <dt className="text-ink-3">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

/** How one algorithm behaved: policy facts from the run, validation and runtime. */
export function AlgorithmCard({ algorithm, side }) {
  if (!side) return null;
  const meta = ALGORITHM_META[algorithm];
  const details = side.details ?? {};
  const assumptions = details.assumptions;

  return (
    <Card>
      <CardHeader
        title={<AlgorithmTag algorithm={algorithm} long className="text-base font-semibold" />}
        description={meta.blurb}
        actions={side.published ? <Badge tone="good" icon="shield">Published</Badge> : null}
      />
      <CardBody>
        <div className="mb-3"><ValidationBadge validation={side.validation} /></div>
        <dl className="divide-y divide-line">
          {algorithm === "baseline" && details.phaseSummary ? (
            <DetailRow label="Seats given">
              {formatInt(details.phaseSummary.merit?.allocated)} by merit · {formatInt(details.phaseSummary.random?.allocated)} by lottery
            </DetailRow>
          ) : null}
          {algorithm === "optimized" && assumptions && !Array.isArray(assumptions) ? (
            <>
              <DetailRow label="Objective">{assumptions.objective}</DetailRow>
              <DetailRow label="Merit / lottery quotas">
                {assumptions.meritRandomQuotasPreserved
                  ? "Preserved"
                  : assumptions.floorApplied
                    ? "Not preserved (held to the baseline's results instead)"
                    : assumptions.cgpaPriority
                      ? "Not preserved (CGPA decides ties instead)"
                      : "Not preserved (CGPA is ignored)"}
              </DetailRow>
              <DetailRow label="Timetable search">
                {formatInt(assumptions.flowSolves)} flow solve{assumptions.flowSolves === 1 ? "" : "s"} · {formatInt(assumptions.conflictBranches)} clash branch{assumptions.conflictBranches === 1 ? "" : "es"}
              </DetailRow>
              {assumptions.floorApplied !== undefined ? (
                <DetailRow label="Held to the baseline">
                  {assumptions.floorApplied
                    ? `Yes: ${formatInt(assumptions.floorSlots)} results protected, ${formatInt(assumptions.preferencesRemovedByFloor)} worse choices ruled out`
                    : "No"}
                </DetailRow>
              ) : null}
              {assumptions.cgpaPriority !== undefined ? (
                <DetailRow label="CGPA used by the optimizer">
                  {assumptions.cgpaPriority ? "Yes: higher CGPA gets the better choices among equal results" : "No"}
                </DetailRow>
              ) : null}
              {assumptions.preferencesRemovedByFixedSlots > 0 ? (
                <DetailRow label="Compulsory classes">
                  {formatInt(assumptions.preferencesRemovedByFixedSlots)} ranked course{assumptions.preferencesRemovedByFixedSlots === 1 ? "" : "s"} left out because they overlap a student's compulsory class
                </DetailRow>
              ) : null}
              {assumptions.optimal === false ? (
                <DetailRow label="Result quality">
                  <span className="text-warning-ink">
                    Search stopped early ({assumptions.searchStopReason === "time-limit" ? "time limit" : "search limit"}), so this may not be the best possible.
                    {assumptions.searchBound
                      ? ` No answer can have more than ${formatInt(assumptions.searchBound.assignments)} assignments or, for that many, a preference cost below ${formatInt(assumptions.searchBound.preferenceCost)}.`
                      : ""}
                  </span>
                </DetailRow>
              ) : null}
              {details.totalPreferenceCost !== undefined && details.totalPreferenceCost !== null ? (
                <DetailRow label="Total preference cost">{formatInt(details.totalPreferenceCost)}</DetailRow>
              ) : null}
            </>
          ) : null}
          <DetailRow label="Runtime">{formatMetric("runtimeMs", side.runtimeMs)}</DetailRow>
        </dl>

        {Array.isArray(assumptions) && assumptions.length ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-2">
            {assumptions.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        ) : null}

        {side.validation && !side.validation.valid && side.validation.errorList?.length ? (
          <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm text-critical-ink">
            {side.validation.errorList.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  );
}

/** A run that holds one algorithm only: its numbers, and a way to get the comparison. */
function SingleAlgorithmView({ summary }) {
  const algorithm = ALGORITHMS.find((a) => summary.algorithms[a]);
  const side = summary.algorithms[algorithm];
  const other = algorithm === "baseline" ? "optimized" : "baseline";
  return (
    <div className="space-y-6">
      <Alert
        tone="info"
        title={`This run contains only the ${ALGORITHM_META[algorithm].label.toLowerCase()} algorithm`}
        action={<Link to="/runs/new" className={buttonClass({ size: "sm" })}>Run both</Link>}
      >
        Start a run with both algorithms on the same semester to see them side by side
        (or run the {ALGORITHM_META[other].label.toLowerCase()} algorithm separately).
      </Alert>
      <section aria-label="Headline numbers" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {HEADLINE_KEYS.map((key) => (
          <div key={key} className="rounded-xl border border-line bg-surface p-4 shadow-card">
            <p className="text-sm text-ink-2" title={METRIC_BY_KEY[key].help}>{METRIC_BY_KEY[key].label}</p>
            <p className="mt-2 text-2xl font-semibold text-ink">{formatMetric(key, metricValue(side, key))}</p>
          </div>
        ))}
      </section>
      <AlgorithmCard algorithm={algorithm} side={side} />
    </div>
  );
}

export function ComparisonOverview({ summary }) {
  if (!summary.comparison.available) return <SingleAlgorithmView summary={summary} />;

  return (
    <div className="space-y-6">
      <PolicyNotice summary={summary} />

      <BaselineEvidence evidence={summary.comparison.evidence} />

      <section aria-label="Headline numbers" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {HEADLINE_KEYS.map((key) => <MetricCompareCard key={key} metricKey={key} summary={summary} />)}
      </section>

      <Card>
        <CardHeader title="Side by side" description="Students and assignments by outcome." actions={<ChartLegend />} />
        <CardBody>
          <MetricsChart summary={summary} />
          <p className="mt-2 text-xs text-ink-3">The same numbers are in the table below.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="All metrics"
          description="Difference is optimized minus baseline. Colour shows which way is better for that one metric; it is not an overall verdict."
        />
        <ComparisonTable summary={summary} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <AlgorithmCard algorithm="baseline" side={summary.algorithms.baseline} />
        <AlgorithmCard algorithm="optimized" side={summary.algorithms.optimized} />
      </div>
    </div>
  );
}
