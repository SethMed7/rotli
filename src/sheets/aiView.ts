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

function cellText(cell: SheetModelCell): string {
  const value =
    cell.v === undefined ? "" : typeof cell.v === "string" ? JSON.stringify(cell.v) : String(cell.v);
  if (cell.f) return value ? `${cell.f} → ${value}` : cell.f;
  return value;
}

/** A workbook as addressed cells, sheet by sheet, at most `maxCells` of them. */
export function sheetModelForAi(model: SheetModel, maxCells = 4000): string {
  let budget = maxCells;
  const out: string[] = [];
  for (const id of model.sheetOrder) {
    const tab = model.sheets[id];
    if (!tab) continue;
    const rows = Object.keys(tab.cellData ?? {})
      .map(Number)
      .sort((a, b) => a - b);
    let lastRow = 0;
    let lastCol = 0;
    const lines: string[] = [];
    for (const r of rows) {
      const cells = tab.cellData?.[r] ?? {};
      const parts = Object.keys(cells)
        .map(Number)
        .sort((a, b) => a - b)
        .flatMap((c) => {
          const text = cellText(cells[c] ?? {});
          if (!text) return [];
          lastRow = Math.max(lastRow, r + 1);
          lastCol = Math.max(lastCol, c + 1);
          return [`${columnName(c)}${r + 1} ${text}`];
        });
      if (parts.length === 0) continue;
      if (budget <= 0) {
        lines.push(`… stopped at row ${r + 1}: the rest of this sheet isn't shown`);
        break;
      }
      budget -= parts.length;
      lines.push(parts.join(" | "));
    }
    const size = lastRow > 0 ? `${lastRow} rows × ${lastCol} columns used` : "empty";
    out.push([`## Sheet "${tab.name}" (${size})`, ...lines].join("\n"));
  }
  return out.join("\n\n");
}
