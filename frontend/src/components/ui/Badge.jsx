import { cn } from "./cn.js";
import { Icon } from "./Icon.jsx";
import { Spinner } from "./Spinner.jsx";
import { ALGORITHM_META } from "../../lib/chartTheme.js";

const TONES = {
  neutral: "bg-wash text-ink-2",
  accent: "bg-accent-soft text-accent-ink",
  good: "bg-good-soft text-good-ink",
  warning: "bg-warning-soft text-warning-ink",
  critical: "bg-critical-soft text-critical-ink",
};

/** Status is never colour alone: every badge carries a label and (usually) an icon. */
export function Badge({ tone = "neutral", icon, children, className }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", TONES[tone], className)}>
      {icon ? <Icon name={icon} className="size-3.5" /> : null}
      {children}
    </span>
  );
}

const RUN_STATUS = {
  pending: { tone: "neutral", icon: "clock", label: "Pending" },
  running: { tone: "accent", icon: null, label: "Running", spinner: true },
  completed: { tone: "neutral", icon: "check", label: "Completed" },
  publishing: { tone: "accent", icon: null, label: "Publishing", spinner: true },
  published: { tone: "good", icon: "shield", label: "Published" },
  failed: { tone: "critical", icon: "alert", label: "Failed" },
  cancelled: { tone: "neutral", icon: "ban", label: "Cancelled" },
};

export function StatusBadge({ status }) {
  const meta = RUN_STATUS[status] ?? { tone: "neutral", icon: "info", label: status ?? "Unknown" };
  return (
    <Badge tone={meta.tone} icon={meta.spinner ? undefined : meta.icon}>
      {meta.spinner ? <Spinner className="size-3" /> : null}
      {meta.label}
    </Badge>
  );
}

/** Algorithm identity: the coloured swatch beside the name carries it; the text stays in ink. */
export function AlgorithmTag({ algorithm, long = false, className }) {
  const meta = ALGORITHM_META[algorithm];
  if (!meta) return null;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm text-ink", className)}>
      <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: meta.color }} />
      {long ? meta.long : meta.label}
    </span>
  );
}
