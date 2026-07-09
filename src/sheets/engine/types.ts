// Engine-neutral sheet model shapes — structural mirrors of the active engine's
// wire format (today Univer's IWorkbookData). Only sheets/engine/* may import
// the runtime; everything else depends on these types.

export interface SheetBorderSide {
  s: number;
  cl?: { rgb: string };
}

export interface SheetModelStyle {
  bl?: 0 | 1;
  it?: 0 | 1;
  ul?: { s: 0 | 1 };
  fs?: number;
  ff?: string;
  cl?: { rgb: string } | null;
  bg?: { rgb: string } | null;
  ht?: 0 | 1 | 2 | 3;
  vt?: 0 | 1 | 2 | 3;
  tb?: 1 | 2 | 3;
  bd?: { t?: SheetBorderSide; b?: SheetBorderSide; l?: SheetBorderSide; r?: SheetBorderSide };
  n?: { pattern: string };
}

export interface SheetModelCell {
  v?: string | number | boolean;
  f?: string;
  s?: string | SheetModelStyle | null;
  t?: number;
}

export interface SheetModelMerge {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
}

export interface SheetModelTab {
  id: string;
  name: string;
  cellData?: Record<number, Record<number, SheetModelCell>>;
  rowCount?: number;
  columnCount?: number;
  columnData?: Record<number, { w?: number }>;
  rowData?: Record<number, { h?: number }>;
  mergeData?: SheetModelMerge[];
  freeze?: { xSplit: number; ySplit: number; startRow: number; startColumn: number };
}

/** The in-memory model the engine loads/saves — engine-agnostic name. */
export interface SheetModel {
  id: string;
  name: string;
  sheetOrder: string[];
  sheets: Record<string, SheetModelTab>;
  styles?: Record<string, SheetModelStyle>;
  locale?: string;
}

export type SheetThemeMode = "themed" | "raw";
