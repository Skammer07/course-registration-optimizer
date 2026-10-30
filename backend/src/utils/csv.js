/**
 * src/utils/csv.js
 * Small RFC 4180 CSV reader/writer (no dependency).
 *
 * Reader: UTF-8 BOM, CRLF/LF/CR line ends, quoted fields with "" escapes and
 * embedded commas/newlines, blank lines skipped. Every record keeps the
 * physical line number where it starts, so import errors can point at the row.
 */

export class CsvParseError extends Error {
  constructor(message, line = null) {
    super(message);
    this.name = "CsvParseError";
    this.line = line;
  }
}

/**
 * @param {string} input
 * @returns {{ line: number, cells: string[] }[]}
 */
export function parseCsv(input) {
  let text = String(input ?? "");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const records = [];
  let cells = [];
  let field = "";
  let quoted = false; // currently inside "..."
  let wasQuoted = false; // the current field started with a quote
  let line = 1;
  let recordLine = 1;

  const endField = () => {
    cells.push(field);
    field = "";
    wasQuoted = false;
  };
  const endRecord = () => {
    endField();
    // skip blank lines (a single empty, unquoted field)
    const blank = cells.length === 1 && cells[0] === "";
    if (!blank) records.push({ line: recordLine, cells });
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        if (c === "\n") line++;
        field += c;
      }
      continue;
    }

    if (c === '"' && field === "" && !wasQuoted) {
      quoted = true;
      wasQuoted = true;
    } else if (c === ",") {
      endField();
    } else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += c;
    }
  }

  if (quoted) throw new CsvParseError("A quoted field is never closed.", recordLine);
  if (field !== "" || cells.length > 0 || wasQuoted) endRecord();
  return records;
}

/**
 * One CSV cell for output. Text starting with = + - @ (or a tab/CR) is prefixed
 * with a quote so spreadsheet software cannot run it as a formula; quotes,
 * commas and line breaks are escaped.
 */
export function csvCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Build CSV text (UTF-8 BOM, CRLF) from a header and rows of values. */
export function buildCsv(header, rows) {
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
