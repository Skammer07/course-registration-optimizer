import { useState } from "react";
import { cn } from "./cn.js";
import { Icon } from "./Icon.jsx";
import { describeError } from "../../lib/errors.js";

const TONES = {
  info: { box: "border-accent-line bg-accent-soft text-accent-ink", icon: "info" },
  good: { box: "border-[#b8dcb8] bg-good-soft text-good-ink", icon: "check" },
  warning: { box: "border-[#f1d78e] bg-warning-soft text-warning-ink", icon: "alert" },
  critical: { box: "border-[#efc0c0] bg-critical-soft text-critical-ink", icon: "alert" },
};

export function Alert({ tone = "info", title, children, className, action }) {
  const t = TONES[tone];
  return (
    <div
      role={tone === "critical" || tone === "warning" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-xl border px-4 py-3 text-sm", t.box, className)}
    >
      <Icon name={t.icon} className="mt-0.5 size-4.5" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && "mt-0.5", "text-pretty")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** An API error with its plain-language title, hint, field details and the reference id. */
export function ErrorAlert({ error, className }) {
  const [copied, setCopied] = useState(false);
  if (!error) return null;
  const info = describeError(error);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(info.requestId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard not available; the id is still on screen */
    }
  };

  return (
    <Alert tone="critical" title={info.title} className={className}>
      <p>{info.message}</p>
      {info.hint ? <p className="mt-1 opacity-90">{info.hint}</p> : null}
      {info.details.length > 0 ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-5">
          {info.details.slice(0, 10).map((d, i) => (
            <li key={i}>{d}</li>
          ))}
          {info.details.length > 10 ? <li>…and {info.details.length - 10} more</li> : null}
        </ul>
      ) : null}
      {info.requestId ? (
        <p className="mt-2 flex items-center gap-2 text-xs opacity-80">
          Reference: <code className="rounded bg-white/60 px-1.5 py-0.5">{info.requestId}</code>
          <button type="button" onClick={copy} className="underline underline-offset-2 hover:opacity-100">
            {copied ? "Copied" : "Copy"}
          </button>
        </p>
      ) : null}
    </Alert>
  );
}
