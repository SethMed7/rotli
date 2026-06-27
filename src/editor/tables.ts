// GFM table detection (Seth, 2026-06-27) — finds markdown tables so the editor can
// render them beautified (tableRender.ts) and livePreview can leave their lines
// alone, exactly the way fenced code blocks work (fences.ts). A table is a header
// row of `|`-separated cells, a delimiter row (`---`/`:--`/`--:`/`:-:`), then zero
// or more data rows — ending at a blank line or any non-`|` line.

import type { Text } from "@codemirror/state";

export type Align = "left" | "right" | "center" | "";

export interface TableBlock {
  from: number; // doc offset of the table's first char
  to: number; // doc offset of the last cell row's line end
  header: string[];
  align: Align[];
  rows: string[][];
}

const looksLikeRow = (s: string) => s.includes("|") && s.trim().length > 0;

/** A delimiter row: each cell is dashes with optional leading/trailing colons. */
function parseDelimiter(s: string): Align[] | null {
  const t = s.trim();
  if (!/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(t)) return null;
  const cells = splitRow(t);
  if (cells.length === 0) return null;
  return cells.map((c) => {
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return "";
  });
}

/** Split a `| a | b |` row into trimmed cells, dropping the empty edges that the
 * optional leading/trailing pipes produce. */
export function splitRow(s: string): string[] {
  const cells = s.trim().split("|").map((c) => c.trim());
  if (cells.length && cells[0] === "") cells.shift();
  if (cells.length && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

/** All GFM tables in the doc, in order. */
export function scanTables(doc: Text): TableBlock[] {
  const out: TableBlock[] = [];
  const total = doc.lines;
  let n = 1;
  while (n < total) {
    const headLine = doc.line(n);
    const delimLine = doc.line(n + 1);
    if (looksLikeRow(headLine.text)) {
      const align = parseDelimiter(delimLine.text);
      const header = splitRow(headLine.text);
      if (align && header.length > 0) {
        // gather data rows until a blank / non-row line
        const rows: string[][] = [];
        let last = n + 1;
        let r = n + 2;
        while (r <= total) {
          const t = doc.line(r).text;
          if (!looksLikeRow(t)) break;
          rows.push(splitRow(t));
          last = r;
          r++;
        }
        out.push({
          from: headLine.from,
          to: doc.line(last).to,
          header,
          align,
          rows,
        });
        n = last + 1;
        continue;
      }
    }
    n++;
  }
  return out;
}

/** True when a line (by its `from` offset) sits inside any detected table. */
export function lineInTable(lineFrom: number, tables: TableBlock[]): boolean {
  return tables.some((t) => lineFrom >= t.from && lineFrom <= t.to);
}
