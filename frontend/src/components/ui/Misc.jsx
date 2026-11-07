import { Link } from "react-router-dom";
import { cn } from "./cn.js";
import { Icon } from "./Icon.jsx";

/** Page title row: optional back link, subtitle and right-aligned actions. */
export function PageHeader({ title, subtitle, actions, back, children }) {
  return (
    <header className="mb-6">
      {back ? (
        <Link to={back.to} className="mb-2 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
          <Icon name="chevronLeft" className="size-4" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle ? <div className="mt-1 text-sm text-ink-3">{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}

/** Nothing here yet / nothing matches: say why and what to do next. */
export function EmptyState({ icon = "info", title, description, action, className }) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-wash text-ink-3">
        <Icon name={icon} className="size-5" />
      </span>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description ? <p className="mt-1 max-w-md text-sm text-ink-3 text-pretty">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }) {
  return <div className={cn("animate-pulse rounded-md bg-wash", className)} aria-hidden="true" />;
}

/** A fixed-height block of table-like skeleton rows. */
export function TableSkeleton({ rows = 6 }) {
  return (
    <div className="space-y-2 p-4" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

/** Meter: a ratio against a limit. The track is a lighter step of the fill's own colour. */
export function Meter({ value, max, label, color = "var(--color-baseline)", className }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      className={cn("h-2 w-full overflow-hidden rounded-full", className)}
      style={{ background: "color-mix(in srgb, " + color + " 16%, var(--color-surface))" }}
    >
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/** Shared table styling. */
export const tableClass = "w-full border-collapse text-left text-sm";
export const thClass = "sticky top-0 whitespace-nowrap border-b border-line bg-surface px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-3";
export const tdClass = "border-b border-line px-4 py-3 align-middle";
