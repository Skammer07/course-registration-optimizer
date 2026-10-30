/**
 * src/utils/duration.js
 * Converts a JWT-style duration ("15m", "2h", "7d", "900s" or plain seconds)
 * to milliseconds so the cookie lifetime always matches the token lifetime.
 */

const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export function durationToMs(value, fallbackMs = 15 * 60_000) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value * 1000;
  const match = /^(\d+)\s*([smhd])?$/i.exec(String(value ?? "").trim());
  if (!match) return fallbackMs;
  const n = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  return n > 0 ? n * UNIT_MS[unit] : fallbackMs;
}
