import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

/** Sets the browser tab title: "Runs · Course Allocation". */
export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · Course Allocation` : "Course Allocation";
  }, [title]);
}

/** A value that only follows `value` after it has stopped changing for `delay` ms. */
export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** Seconds since `active` became true (0 while inactive). Drives the "running for mm:ss" timer. */
export function useElapsedSeconds(active) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return undefined;
    }
    const start = Date.now();
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(t);
  }, [active]);
  return seconds;
}

/**
 * Filters kept in the address (?search=...&page=2), so a view can be bookmarked, shared and
 * survives a reload. `update` merges a patch, drops empty values, and goes back to page 1
 * unless the patch sets the page itself.
 */
export function useQueryParams() {
  const [params, setParams] = useSearchParams();
  const update = useCallback(
    (patch) => {
      const next = new URLSearchParams(params);
      const withReset = "page" in patch ? patch : { ...patch, page: undefined };
      for (const [key, value] of Object.entries(withReset)) {
        if (value === undefined || value === null || value === "") next.delete(key);
        else next.set(key, String(value));
      }
      setParams(next, { replace: true });
    },
    [params, setParams]
  );
  return [params, update];
}
