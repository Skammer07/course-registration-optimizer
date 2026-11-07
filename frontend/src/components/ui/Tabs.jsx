import { useId, useRef } from "react";
import { cn } from "./cn.js";

/**
 * Accessible tab list (arrow keys move between tabs). The panels are rendered by the caller;
 * give each panel role="tabpanel" and aria-labelledby={tabId(prefix, value)}.
 */
export function Tabs({ value, onChange, tabs, label = "Sections", prefix }) {
  const auto = useId();
  const id = prefix ?? auto;
  const refs = useRef({});

  const onKeyDown = (e, index) => {
    let next = null;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = tabs.length - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next].value);
    refs.current[tabs[next].value]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((tab, i) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(el) => (refs.current[tab.value] = el)}
            id={tabId(id, tab.value)}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              active ? "border-accent text-accent-ink" : "border-transparent text-ink-2 hover:text-ink"
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export const tabId = (prefix, value) => `${prefix}-tab-${value}`;
