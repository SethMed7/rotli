import { describe, expect, test } from "bun:test";

import { bytesFromB64, tablesFromXlsx } from "./codec/xlsx";
import { createWorkbookFromCsvBase64 } from "./create";

describe("populated workbook creation", () => {
  test("keeps model CSV values exact in an editable XLSX", async () => {
    const base64 = await createWorkbookFromCsvBase64(
      'Account,Code\nNorth,"007"\nSouth,"12345678901234567"',
      "Plan",
    );
    const bytes = bytesFromB64(base64);
    const tables = await tablesFromXlsx(bytes.buffer as ArrayBuffer, 10);
    expect(tables[0]).toEqual({
      name: "Plan",
      rows: [
        ["Account", "Code"],
        ["North", "007"],
        ["South", "12345678901234567"],
      ],
      truncated: false,
    });
  });

  test("refuses an empty workbook artifact", async () => {
    await expect(createWorkbookFromCsvBase64("\n\n")).rejects.toThrow("no cells");
  });
});
