import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { cn } from "./cn.js";
import { Icon } from "./Icon.jsx";

const ToastContext = createContext(null);

const TONE = {
  good: { icon: "check", box: "border-[#b8dcb8]", ink: "text-good-ink" },
  info: { icon: "info", box: "border-accent-line", ink: "text-accent-ink" },
  critical: { icon: "alert", box: "border-[#efc0c0]", ink: "text-critical-ink" },
};

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const counter = useRef(0);

  const dismiss = useCallback((id) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback(
    ({ tone = "info", title, message }) => {
      const id = ++counter.current;
      setItems((list) => [...list.slice(-3), { id, tone, title, message }]);
      setTimeout(() => dismiss(id), tone === "critical" ? 9000 : 5000);
      return id;
    },
    [dismiss]
  );

  const api = useMemo(
    () => ({
      success: (title, message) => push({ tone: "good", title, message }),
      info: (title, message) => push({ tone: "info", title, message }),
      error: (title, message) => push({ tone: "critical", title, message }),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end">
        {items.map((t) => {
          const tone = TONE[t.tone];
          return (
            <div key={t.id} role="status" className={cn("pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border bg-surface p-3 shadow-[var(--shadow-pop)]", tone.box)}>
              <Icon name={tone.icon} className={cn("mt-0.5 size-5", tone.ink)} />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold text-ink">{t.title}</p>
                {t.message ? <p className="mt-0.5 text-ink-2">{t.message}</p> : null}
              </div>
              <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="rounded p-0.5 text-ink-3 hover:text-ink">
                <Icon name="x" className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
