// Public engine entry — swap engines by replacing ./univer only.
export { mountSheet, type SheetHandle } from "./univer";
export type { SheetModel, SheetThemeMode } from "./types";
export { applyModelToWorkbook, buildSheetIdMap, csvRowsFromSnapshot, workbookToModel } from "./bridge";
