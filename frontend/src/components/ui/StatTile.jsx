import { cn } from "./cn.js";

const TONE = {
  neutral: "text-ink",
  good: "text-good-ink",
  warning: "text-warning-ink",
  critical: "text-critical-ink",
};

/**
 * A headline number: label, value, one line of context. The tone only colours the value; the
 * hint always says in words what the number means, so colour is never the only cue.
 */
export function StatTile({ label, value, hint, tone = "neutral", className }) {
  return (
    <div className={cn("rounded-xl border border-line bg-surface p-4 shadow-card", className)}>
      <p className="text-sm text-ink-2">{label}</p>
      <p className={cn("mt-1.5 text-2xl font-semibold", TONE[tone])}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}

/** A responsive row of tiles. */
export function StatRow({ label, children, className }) {
  return (
    <section aria-label={label} className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {children}
    </section>
  );
}
