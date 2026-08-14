// Workbook creation boundary. Slash UI does not know which spreadsheet codec
// produces the file, so ExcelJS can be replaced without changing picker logic.

import { b64FromBytes, fillFromCsvRows, newWorkbook, saveXlsx } from "./codec/xlsx";
import { parseCsvExact } from "./csv";

export async function createBlankWorkbookBase64(): Promise<string> {
  const workbook = newWorkbook();
  workbook.addWorksheet("Sheet1");
  return b64FromBytes(await saveXlsx(workbook));
}

/** Model-created sheets cross the boundary as RFC-4180 CSV, then become an
 * ordinary editable XLSX through the same replaceable codec as blank sheets. */
export async function createWorkbookFromCsvBase64(csv: string, sheetName = "Sheet1"): Promise<string> {
  const rows = parseCsvExact(csv);
  if (rows.length === 0 || rows.every((row) => row.every((cell) => cell.trim() === ""))) {
    throw new Error("sheet content has no cells");
  }
  const workbook = fillFromCsvRows(newWorkbook(), sheetName, rows);
  return b64FromBytes(await saveXlsx(workbook));
}
