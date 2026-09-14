import { expect, test } from "bun:test";

import { sheetEditableFile, sheetFormatEditable, sheetReadOnlyReason, workbookWithheld } from "./kinds";

const stable = { sheets: false };
const dev = { sheets: true };

test("stable withholds binary workbooks but keeps CSV editing", () => {
  expect(workbookWithheld("xlsx", stable)).toBe(true);
  expect(workbookWithheld("xlsm", stable)).toBe(true);
  expect(workbookWithheld("csv", stable)).toBe(false);
  expect(workbookWithheld("xlsx", dev)).toBe(false);
  expect(sheetFormatEditable("csv", stable)).toBe(true);
  expect(sheetFormatEditable("xlsx", stable)).toBe(false);
  expect(sheetFormatEditable("xlsx", dev)).toBe(true);
  expect(sheetFormatEditable("tsv", dev)).toBe(false);
});

test("an editable sheet file also needs a writable root and the byte gate", () => {
  // bun test compiles as the stable channel
  expect(sheetEditableFile("csv", { writable: true, len: 10 })).toBe(true);
  expect(sheetEditableFile("xlsx", { writable: true, len: 10 })).toBe(false);
  expect(sheetEditableFile("csv", { writable: false, len: 10 })).toBe(false);
  expect(sheetEditableFile("csv", { writable: true, len: 9_000_000 })).toBe(false);
  expect(sheetEditableFile("csv", null)).toBe(false);
});

test("every read-only sheet names its reason", () => {
  expect(sheetReadOnlyReason(null, "csv").title.includes("couldn't verify")).toBe(true);
  expect(sheetReadOnlyReason({ writable: false }, "csv").label).toBe("read-only");
  expect(sheetReadOnlyReason({ writable: true }, "tsv").label).toBe("view only · .tsv");
  expect(sheetReadOnlyReason({ writable: true }, "csv").title.startsWith("Too large")).toBe(true);
});
