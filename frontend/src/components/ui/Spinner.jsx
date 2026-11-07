import { cn } from "./cn.js";

export function Spinner({ className = "size-4", label }) {
  return (
    <span role={label ? "status" : undefined} aria-label={label} className="inline-flex">
      <svg viewBox="0 0 24 24" className={cn("animate-spin", className)} aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** Full-area loading state for a page or panel. */
export function PageSpinner({ label = "Loading" }) {
  return (
    <div className="flex min-h-48 items-center justify-center gap-3 text-ink-2">
      <Spinner className="size-5" />
      <span>{label}…</span>
    </div>
  );
}
