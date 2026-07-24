// Derived file facts for the sheet Details panel (decision 2026-07-22,
// feature D) — a READ-ONLY display of what is true about the file right now.
// Everything here is computed from the stat probe and the parsed tables; facts
// are never written anywhere (boards/binaries stay frontmatter-free, and a
// copied path would go stale on the first filing move).

import type { FileStat } from "../lib/tauri";
import type { SheetTable } from "./view";

/** One sheet's shape as the panel shows it. `rows` counts what the parser saw;
 * `truncated` means the sheet had MORE rows than the parse cap, so the panel
 * must say "N+" instead of implying an exact total. */
export interface SheetShape {
  name: string;
  rows: number;
  cols: number;
  truncated: boolean;
}

export interface SheetFacts {
  /** "CSV" | "TSV" | "Excel workbook" — the honest format family label. */
  format: string;
  /** Present for delimited text: what the exact parser split on. */
  delimiter?: "comma" | "tab";
  /** Delimited text is decoded as UTF-8 by the read path — stated, not sniffed. */
  encoding?: "UTF-8";
  sheets: SheetShape[];
}

/** The format family for a sheet extension ("" for anything else). */
export function sheetFormatLabel(ext: string): string {
  if (ext === "csv") return "CSV";
  if (ext === "tsv") return "TSV";
  if (ext === "xlsx" || ext === "xlsm") return "Excel workbook";
  return "";
}

/** Derive the panel facts from parsed tables. Column count is the WIDEST row —
 * ragged CSV rows are real, and under-reporting would hide data. */
export function deriveSheetFacts(ext: string, tables: SheetTable[]): SheetFacts {
  const text = ext === "csv" || ext === "tsv";
  return {
    format: sheetFormatLabel(ext) || `.${ext}`,
    ...(text
      ? { delimiter: ext === "tsv" ? ("tab" as const) : ("comma" as const), encoding: "UTF-8" as const }
      : {}),
    sheets: tables.map((t) => ({
      name: t.name,
      rows: t.rows.length,
      cols: t.rows.reduce((w, r) => Math.max(w, r.length), 0),
      truncated: t.truncated,
    })),
  };
}

/** "2,000+ rows × 14 columns" — the one dims grammar (truncated ⇒ "+"). */
export function describeShape(s: SheetShape): string {
  const rows = `${s.rows.toLocaleString()}${s.truncated ? "+" : ""} ${s.rows === 1 && !s.truncated ? "row" : "rows"}`;
  return `${rows} × ${s.cols.toLocaleString()} ${s.cols === 1 ? "column" : "columns"}`;
}

/** Human byte size — exact bytes below 1 KB, one decimal above. */
export function formatBytes(len: number): string {
  if (!Number.isFinite(len) || len < 0) return "—";
  if (len < 1024) return `${len} B`;
  const kb = len / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

/** A stat timestamp for display ("—" when the filesystem couldn't say). */
export function formatStamp(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "—";
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The size line from a stat probe (null probe → "—", e.g. browser mode). */
export function sizeLine(stat: FileStat | null): string {
  return stat ? formatBytes(stat.len) : "—";
}
