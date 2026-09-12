// Cell ranges inside a rendered table: ⇧-click selects a rectangle, ⌘/Ctrl-click
// adds or removes one cell, Delete/Backspace clears every selected cell in one
// edit, and copy writes the selection as tab-separated text. The selection is
// widget state (never the document) and ends when the table re-renders.

import type { EditorView } from "@codemirror/view";

import { flattenCellBreaks } from "./tableCell";
import { type CellRef, type TableBlock, type TableShape, setCellText, tableToText } from "./tables";

export const cellKey = (ref: CellRef): string => `${ref.row}:${ref.col}`;

/** Every cell in the rectangle spanned by two corners, header row included. */
export function cellRectangle(anchor: CellRef, head: CellRef): CellRef[] {
  const cells: CellRef[] = [];
  const [r0, r1] = [Math.min(anchor.row, head.row), Math.max(anchor.row, head.row)];
  const [c0, c1] = [Math.min(anchor.col, head.col), Math.max(anchor.col, head.col)];
  for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) cells.push({ row, col });
  return cells;
}

/** Toggle one cell in a selection; the anchor for the next ⇧-click moves to it. */
export function toggleCell(selected: readonly CellRef[], ref: CellRef): CellRef[] {
  const key = cellKey(ref);
  const without = selected.filter((cell) => cellKey(cell) !== key);
  return without.length === selected.length ? [...selected, ref] : without;
}

const textOf = (t: TableShape, ref: CellRef): string =>
  ref.row === -1 ? (t.header[ref.col] ?? "") : (t.rows[ref.row]?.[ref.col] ?? "");

/** The selection as tab-separated rows in reading order, gaps left empty. */
export function selectionTsv(t: TableShape, selected: readonly CellRef[]): string {
  if (selected.length === 0) return "";
  const rows = [...new Set(selected.map((cell) => cell.row))].sort((a, b) => a - b);
  const cols = [...new Set(selected.map((cell) => cell.col))].sort((a, b) => a - b);
  const keys = new Set(selected.map(cellKey));
  return rows
    .map((row) =>
      cols
        .map((col) => (keys.has(cellKey({ row, col })) ? flattenCellBreaks(textOf(t, { row, col })) : ""))
        .join("\t"),
    )
    .join("\n");
}

/** Clear every selected cell; addresses the table no longer has are skipped. */
export function clearCells(t: TableShape, selected: readonly CellRef[]): TableShape {
  return selected.reduce<TableShape>((shape, ref) => setCellText(shape, ref.row, ref.col, "") ?? shape, t);
}

export interface CellSelection {
  /** True when the press was a selection gesture the caller must not turn into a cell edit. */
  onMouseDown(event: MouseEvent, cell: HTMLTableCellElement): boolean;
}

const refOf = (cell: HTMLTableCellElement): CellRef | null => {
  const row = Number(cell.dataset.tableRow);
  const col = Number(cell.dataset.tableCol);
  return Number.isInteger(row) && Number.isInteger(col) ? { row, col } : null;
};

/** Wire range selection onto one rendered table. */
export function attachCellSelection(
  table: HTMLTableElement,
  view: EditorView,
  tableAtWidget: () => TableBlock | null,
): CellSelection {
  let selected: CellRef[] = [];
  let anchor: CellRef | null = null;
  const paint = () => {
    const keys = new Set(selected.map(cellKey));
    for (const cell of table.querySelectorAll<HTMLTableCellElement>("td,th")) {
      const ref = refOf(cell);
      cell.classList.toggle("is-selected", ref !== null && keys.has(cellKey(ref)));
      cell.setAttribute("aria-selected", String(ref !== null && keys.has(cellKey(ref))));
    }
  };
  const set = (next: CellRef[]) => {
    selected = next;
    paint();
  };

  table.addEventListener("keydown", (event) => {
    if (selected.length === 0 || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === "Escape") {
      set([]);
      return;
    }
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    event.preventDefault();
    event.stopPropagation();
    const current = tableAtWidget();
    if (!current) return;
    view.dispatch({
      changes: { from: current.from, to: current.to, insert: tableToText(clearCells(current, selected)) },
    });
  });
  table.addEventListener("copy", (event) => {
    if (selected.length === 0 || event.target instanceof HTMLTextAreaElement) return;
    const current = tableAtWidget();
    if (!current || !event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", selectionTsv(current, selected));
  });

  return {
    onMouseDown(event, cell) {
      const ref = refOf(cell);
      if (!ref) return false;
      const extend = event.shiftKey && anchor !== null;
      const toggle = event.metaKey || event.ctrlKey;
      if (!extend && !toggle) {
        if (selected.length) set([]);
        return false;
      }
      event.preventDefault();
      if (extend) set(cellRectangle(anchor!, ref));
      else {
        set(toggleCell(selected, ref));
        anchor = ref;
      }
      if (!anchor) anchor = ref;
      cell.focus();
      return true;
    },
  };
}
