// The Univer table shape for one framework-free DocumentTable — split out of
// the document adapter (univer.ts), the only other place Univer types appear.

import type { ITable, ITableCell } from "@univerjs/presets";

import type { DocumentTable, DocumentTableCell } from "../model";

function tableCellSource(cell: DocumentTableCell): ITableCell {
  return {
    margin: {
      start: { v: 10 },
      end: { v: 10 },
      top: { v: 5 },
      bottom: { v: 5 },
    },
    ...(cell.rowSpan !== undefined ? { rowSpan: cell.rowSpan } : {}),
    ...(cell.columnSpan !== undefined ? { columnSpan: cell.columnSpan } : {}),
  };
}

export function documentTableSource(table: DocumentTable): ITable {
  const columnCount = Math.max(
    1,
    table.columnWidths?.length ?? 0,
    ...table.rows.map((row) => row.cells.length),
  );
  const widths =
    table.columnWidths?.length === columnCount
      ? table.columnWidths
      : Array.from({ length: columnCount }, () => 648 / columnCount);
  return {
    tableId: table.id,
    tableRows: table.rows.map((row) => ({
      tableCells: row.cells.map(tableCellSource),
      trHeight: { val: { v: 30 }, hRule: 0 },
    })),
    tableColumns: widths.map((width) => ({ size: { type: 1, width: { v: width } } })),
    align: 0,
    indent: { v: 0 },
    textWrap: 0,
    position: {
      positionH: { relativeFrom: 5, posOffset: 0 },
      positionV: { relativeFrom: 3, posOffset: 0 },
    },
    dist: { distB: 0, distL: 0, distR: 0, distT: 0 },
    cellMargin: {
      start: { v: 10 },
      end: { v: 10 },
      top: { v: 5 },
      bottom: { v: 5 },
    },
    size: { type: 0, width: { v: widths.reduce((sum, width) => sum + width, 0) } },
  };
}
