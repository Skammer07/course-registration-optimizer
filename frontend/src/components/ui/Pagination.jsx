import { Button } from "./Button.jsx";
import { formatInt } from "../../lib/format.js";

/** "Showing 1–25 of 140" with previous / next. Hidden when everything fits on one page. */
export function Pagination({ page, limit, total, totalPages, onPage, noun = "results" }) {
  if (!total) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-3 text-sm text-ink-2">
      <p>
        Showing <span className="tabular font-medium text-ink">{formatInt(from)}–{formatInt(to)}</span> of{" "}
        <span className="tabular font-medium text-ink">{formatInt(total)}</span> {noun}
      </p>
      {totalPages > 1 ? (
        <div className="flex items-center gap-2">
          <Button size="sm" icon="chevronLeft" onClick={() => onPage(page - 1)} disabled={page <= 1}>
            Previous
          </Button>
          <span className="tabular px-1">Page {page} of {totalPages}</span>
          <Button size="sm" onClick={() => onPage(page + 1)} disabled={page >= totalPages}>
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
