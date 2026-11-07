import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ALGORITHMS, ALGORITHM_META, CHART } from "../../lib/chartTheme.js";
import { formatInt } from "../../lib/format.js";
import { CHART_METRIC_KEYS, METRIC_BY_KEY } from "../../lib/metrics.js";

/** One row per count metric: { key, label, baseline, optimized }. */
export function buildChartData(summary) {
  return CHART_METRIC_KEYS.map((key) => ({
    key,
    label: METRIC_BY_KEY[key].label,
    baseline: summary.algorithms.baseline?.metrics?.[key],
    optimized: summary.algorithms.optimized?.metrics?.[key],
  }));
}

/** The same numbers as plain text, for screen readers (the table below carries them too). */
export function describeChart(data) {
  return (
    "Bar chart comparing baseline and optimized. " +
    data.map((d) => `${d.label}: baseline ${d.baseline ?? "n/a"}, optimized ${d.optimized ?? "n/a"}.`).join(" ")
  );
}

export function ChartLegend({ algorithms = ALGORITHMS }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink-2" aria-label="Legend">
      {algorithms.map((a) => (
        <li key={a} className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-2.5 w-4 rounded-[3px]" style={{ background: ALGORITHM_META[a].color }} />
          {ALGORITHM_META[a].label}
        </li>
      ))}
    </ul>
  );
}

/** Values lead, series names follow; a short stroke keys each series (not a filled box). */
export function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-[var(--shadow-pop)]">
      <p className="mb-1 font-medium text-ink">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-[3px] w-3.5 rounded-full" style={{ background: p.color }} />
          <span className="tabular font-semibold text-ink">{formatInt(p.value)}</span>
          <span className="text-ink-2">{ALGORITHM_META[p.dataKey]?.label ?? p.name}</span>
        </div>
      ))}
    </div>
  );
}

/** Direct label on the first row only: name + value at the bar end (never a number on every bar). */
function firstRowLabel(name) {
  return function FirstRowLabel({ x, y, width, height, index, value }) {
    if (index !== 0 || value === undefined) return null;
    return (
      <text x={x + width + 8} y={y + height / 2} dy="0.35em" fontSize={12} fill={CHART.inkSecondary}>
        {name} {formatInt(value)}
      </text>
    );
  };
}

const ROW_HEIGHT = 54;

export function MetricsChart({ summary }) {
  const data = buildChartData(summary);
  const height = data.length * ROW_HEIGHT + 36;

  return (
    <div role="img" aria-label={describeChart(data)} className="overflow-x-auto">
      <div className="min-w-[34rem]" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" barGap={2} barCategoryGap={18} margin={{ top: 4, right: 24, bottom: 4, left: 0 }}>
            <CartesianGrid horizontal={false} stroke={CHART.grid} strokeWidth={1} />
            <XAxis
              type="number"
              allowDecimals={false}
              domain={[0, (max) => Math.max(4, Math.ceil(max * 1.4))]}
              tick={{ fill: CHART.muted, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={176}
              tick={{ fill: CHART.inkSecondary, fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: CHART.axis, strokeWidth: 1 }}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(11, 11, 11, 0.04)" }} />
            {ALGORITHMS.map((a) => (
              <Bar
                key={a}
                dataKey={a}
                name={ALGORITHM_META[a].label}
                fill={ALGORITHM_META[a].color}
                barSize={14}
                radius={[0, 4, 4, 0]}
                isAnimationActive={false}
                activeBar={{ fillOpacity: 0.82 }}
              >
                <LabelList dataKey={a} content={firstRowLabel(ALGORITHM_META[a].label)} />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
