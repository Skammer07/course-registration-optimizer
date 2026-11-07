import { useId } from "react";
import { cn } from "./cn.js";

export const inputClass =
  "block h-10 w-full rounded-lg border border-muted bg-surface px-3 text-sm text-ink placeholder:text-ink-3 " +
  "transition-colors hover:border-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 " +
  "disabled:bg-wash disabled:text-muted aria-[invalid=true]:border-critical";

/**
 * Native select with our own chevron. The browser's default arrow sits flush against the
 * right edge, so it is switched off and a chevron is drawn 0.75rem in from the edge, with
 * room reserved so long option text never runs under it.
 */
export const selectClass =
  inputClass +
  " cursor-pointer appearance-none pr-9 " +
  "bg-[url('data:image/svg+xml;utf8,<svg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2020%2020%22%20fill=%22none%22%20stroke=%22%2352514e%22%20stroke-width=%221.75%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22><path%20d=%22M5%207.5l5%205%205-5%22/></svg>')] " +
  "bg-[length:1.1rem] bg-[right_0.7rem_center] bg-no-repeat";

/** Label + control + hint + error, wired together for screen readers. */
export function Field({ label, hint, error, required, className, children }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        {required ? <span className="text-critical-ink" aria-hidden="true"> *</span> : null}
      </label>
      {children({ id, "aria-describedby": [hintId, errId].filter(Boolean).join(" ") || undefined, "aria-invalid": error ? true : undefined })}
      {hint && !error ? <p id={hintId} className="text-xs text-ink-3">{hint}</p> : null}
      {error ? <p id={errId} className="text-xs font-medium text-critical-ink">{error}</p> : null}
    </div>
  );
}

export function TextField({ label, hint, error, required, className, inputClassName, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} required={required} className={className}>
      {(a11y) => <input className={cn(inputClass, inputClassName)} required={required} {...a11y} {...props} />}
    </Field>
  );
}

export function SelectField({ label, hint, error, className, children, ...props }) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(a11y) => (
        <select className={selectClass} {...a11y} {...props}>
          {children}
        </select>
      )}
    </Field>
  );
}

/** Compact select for filter rows (label is visually hidden but present). */
export function FilterSelect({ label, className, children, ...props }) {
  return (
    <label className={cn("block", className)}>
      <span className="sr-only">{label}</span>
      <select className={cn(selectClass, "h-9")} aria-label={label} {...props}>
        {children}
      </select>
    </label>
  );
}

/** A labelled on/off switch. */
export function Switch({ checked, onChange, label, description, id: idProp }) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-ink">{label}</label>
        {description ? <p className="mt-0.5 text-xs text-ink-3">{description}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-accent" : "bg-muted"
        )}
      >
        <span
          className={cn(
            "absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform",
            checked && "translate-x-5"
          )}
        />
      </button>
    </div>
  );
}

/** Radio-style segmented control. options: [{ value, label, description? }] */
export function Segmented({ value, onChange, options, label, className }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-lg border border-line-strong bg-wash p-0.5", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:text-ink"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
