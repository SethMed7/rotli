// Workbook creation boundary. Slash UI does not know which spreadsheet codec
// produces the file, so ExcelJS can be replaced without changing picker logic.

import { b64FromBytes, newWorkbook, saveXlsx } from "./codec/xlsx";

export async function createBlankWorkbookBase64(): Promise<string> {
  const workbook = newWorkbook();
  workbook.addWorksheet("Sheet1");
  return b64FromBytes(await saveXlsx(workbook));
}
