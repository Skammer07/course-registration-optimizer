/** Small formatting helpers. Pure functions, easy to test. */

const numberFmt = new Intl.NumberFormat("en-IN");
const dateFmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });
const dateOnlyFmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

export function formatInt(value) {
  return Number.isFinite(value) ? numberFmt.format(value) : "–";
}

/** Fixed digits, trailing zeros kept so columns stay even: 1.4 -> "1.40". */
export function formatFixed(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "–";
}

/** The run metrics already hold a percentage (87.18 means 87.18%). */
export function formatPercentValue(percent, digits = 1) {
  return Number.isFinite(percent) ? `${percent.toFixed(digits)}%` : "–";
}

/** The by-course view holds a fraction (0.5 means 50%). */
export function formatFraction(fraction, digits = 0) {
  return Number.isFinite(fraction) ? `${(fraction * 100).toFixed(digits)}%` : "–";
}

export function formatDateTime(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  return Number.isNaN(+d) ? "–" : dateFmt.format(d);
}

export function formatDate(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  return Number.isNaN(+d) ? "–" : dateOnlyFmt.format(d);
}

/** 8.2 ms, 2.9 s, 1 min 5 s */
export function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "–";
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s - m * 60)} s`;
}

/** mm:ss for a running timer */
export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function plural(count, one, many = `${one}s`) {
  return `${formatInt(count)} ${count === 1 ? one : many}`;
}

/** Signed difference for tables: +5, −0.36, 0 (uses a real minus sign). */
export function formatSigned(value, digits = 0) {
  if (!Number.isFinite(value)) return "–";
  if (value === 0) return "0";
  const abs = Math.abs(value).toFixed(digits);
  return `${value > 0 ? "+" : "−"}${digits ? abs : numberFmt.format(Math.abs(value))}`;
}

/** "2 hours ago" / "in 3 days" */
export function formatRelative(iso, now = Date.now()) {
  if (!iso) return "–";
  const diff = new Date(iso).getTime() - now;
  if (Number.isNaN(diff)) return "–";
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(diff) >= size) return rtf.format(Math.round(diff / size), unit);
  }
  return "just now";
}

/** 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 11 -> "11th" */
export function ordinal(n) {
  if (!Number.isInteger(n)) return "–";
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}
