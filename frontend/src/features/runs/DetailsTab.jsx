import { Alert } from "../../components/ui/Alert.jsx";
import { AlgorithmTag } from "../../components/ui/Badge.jsx";
import { Card, CardBody, CardHeader } from "../../components/ui/Card.jsx";
import { ALGORITHMS } from "../../lib/chartTheme.js";
import { formatDateTime, formatDuration, formatInt } from "../../lib/format.js";
import { ValidationBadge } from "./ComparisonOverview.jsx";

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words text-right text-ink">{children}</dd>
    </div>
  );
}

/** Everything needed to understand (and reproduce) the run: settings, inputs, versions, checks. */
export function DetailsTab({ summary }) {
  const { run, algorithms } = summary;
  const cfg = run.configuration ?? {};
  const baseline = Boolean(algorithms.baseline);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Settings used" description="The options this run was started with." />
        <CardBody>
          <dl className="divide-y divide-line">
            <Row label="Semester">{run.semesterId}</Row>
            <Row label="Max courses per student">{formatInt(cfg.maxCoursesPerStudent)}</Row>
            <Row label="Timetable clash check">{cfg.timetableValidationEnabled ? "On" : "Off"}</Row>
            {baseline ? (
              <>
                <Row label="Baseline seat split">
                  {cfg.meritRatio !== null && cfg.meritRatio !== undefined
                    ? `${Math.round(cfg.meritRatio * 100)}% merit · ${Math.round(cfg.randomRatio * 100)}% lottery`
                    : "–"}
                </Row>
                <Row label="Lottery seed">{run.randomSeed ?? "–"}</Row>
              </>
            ) : null}
            <Row label="Algorithm version">{run.algorithmVersion ?? "–"}</Row>
          </dl>
          {baseline && run.randomSeed !== null ? (
            <p className="mt-3 text-xs text-ink-3">
              The same data, settings, seed and algorithm version give the same baseline result again. Use “Verify” on the run to replay it.
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Input data" description="What the algorithms were given." />
        <CardBody>
          <dl className="divide-y divide-line">
            <Row label="Students">{formatInt(run.inputCounts.students)}</Row>
            <Row label="Courses">{formatInt(run.inputCounts.courses)}</Row>
            <Row label="Preference entries">{formatInt(run.inputCounts.preferences)}</Row>
            <Row label="Timetable included">{run.inputCounts.timetableIncluded ? "Yes" : "No"}</Row>
            <Row label="Started">{formatDateTime(run.createdAt)}</Row>
            <Row label="Total time">{formatDuration(run.totalRuntimeMs)}</Row>
            {run.publishedAt ? <Row label="Published">{formatDateTime(run.publishedAt)}</Row> : null}
          </dl>
        </CardBody>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader title="Validation" description="Every result is checked independently against the rules before it is stored." />
        <CardBody className="space-y-3">
          {ALGORITHMS.filter((a) => algorithms[a]).map((a) => (
            <div key={a} className="flex flex-wrap items-center justify-between gap-2">
              <AlgorithmTag algorithm={a} long />
              <ValidationBadge validation={algorithms[a].validation} />
            </div>
          ))}
          {run.publicationCheck ? (
            <p className="border-t border-line pt-3 text-sm text-ink-2">
              Last pre-publication check ({run.publicationCheck.algorithm}):{" "}
              {run.publicationCheck.valid ? "passed" : `failed with ${run.publicationCheck.errorCount} error(s)`}.
            </p>
          ) : null}
        </CardBody>
      </Card>

      {run.errorSummary ? (
        <Alert tone="critical" title="Why the run did not finish" className="lg:col-span-2">
          {run.errorSummary}
        </Alert>
      ) : null}
    </div>
  );
}
