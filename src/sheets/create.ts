// Workbook creation boundary. Slash UI does not know which spreadsheet codec
// produces the file, so ExcelJS can be replaced without changing picker logic.

import ExcelJS from "exceljs";
import { b64FromBytes } from "./codec/xlsx";

export async function createBlankWorkbookBase64(): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Sheet1");
  return b64FromBytes(new Uint8Array(await workbook.xlsx.writeBuffer()));
}
