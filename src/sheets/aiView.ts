// What the chat reads from a workbook (2026-10-01, the Univer review: CSV
// dropped blank rows and formulas, so a model couldn't address a cell). Every
// non-empty cell by its A1 address, formulas with their last result, real row
// numbers kept; a cap says where it stopped. Pure over the engine's model.

import type { SheetModel, SheetModelCell } from "./engine/types";

/** 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

/** Whether an Excel number format shows a date (its d, y, or h tokens, outside
 * quoted text and [colour] or [locale] brackets). */
function isDatePattern(pattern: string): boolean {
  const bare = pattern.replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
  return /[dy]|h/i.test(bare);
}

/** A date cell's serial as the date it shows (and its time, when it has one). */
function serialDate(serial: number, pattern: string): string {
  const iso = new Date(EXCEL_EPOCH_MS + serial * DAY_MS).toISOString();
  return /[hs]/i.test(pattern.replace(/"[^"]*"|\[[^\]]*\]/g, ""))
    ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
    : iso.slice(0, 10);
}

function cellText(cell: SheetModelCell, styles: SheetModel["styles"]): string {
  const style = typeof cell.s === "string" ? styles?.[cell.s] : cell.s;
  const pattern = style?.n?.pattern;
  const value =
    cell.v === undefined
      ? ""
      : typeof cell.v === "string"
        ? JSON.stringify(cell.v)
        : typeof cell.v === "number" && pattern && isDatePattern(pattern)
          ? serialDate(cell.v, pattern)
          : String(cell.v);
  if (cell.f) return value ? `${cell.f} → ${value}` : cell.f;
  return value;
}

/** A workbook as addressed cells, sheet by sheet, at most `maxCells` of them.
 * Each sheet's size is its real used size, whatever the cap shows of it. */
export function sheetModelForAi(model: SheetModel, maxCells = 4000): string {
  let budget = maxCells;
  const out: string[] = [];
  for (const [index, id] of model.sheetOrder.entries()) {
    if (budget <= 0) {
      const rest = model.sheetOrder.length - index;
      out.push(`… ${rest} more sheet${rest === 1 ? "" : "s"} not shown`);
      break;
    }
    const tab = model.sheets[id];
    if (!tab) continue;
    const rows = Object.keys(tab.cellData ?? {})
      .map(Number)
      .sort((a, b) => a - b);
    let lastRow = 0;
    let lastCol = 0;
    const lines: string[] = [];
    let stopped = false;
    for (const r of rows) {
      const cells = tab.cellData?.[r] ?? {};
      const parts = Object.keys(cells)
        .map(Number)
        .sort((a, b) => a - b)
        .flatMap((c) => {
          const text = cellText(cells[c] ?? {}, model.styles);
          return text ? [{ c, text: `${columnName(c)}${r + 1} ${text}` }] : [];
        });
      if (parts.length === 0) continue;
      lastRow = r + 1;
      lastCol = Math.max(lastCol, ...parts.map((part) => part.c + 1));
      if (stopped) continue;
      if (budget <= 0) {
        lines.push(`… stopped at row ${r + 1}: the rest of this sheet isn't shown`);
        stopped = true;
        continue;
      }
      const shown = parts.slice(0, budget);
      budget -= shown.length;
      lines.push(
        shown.map((part) => part.text).join(" | ") +
          (shown.length < parts.length ? " | … (row cut short)" : ""),
      );
    }
    const size = lastRow > 0 ? `${lastRow} rows × ${lastCol} columns used` : "empty";
    out.push([`## Sheet "${tab.name}" (${size})`, ...lines].join("\n"));
  }
  return out.join("\n\n");
}
