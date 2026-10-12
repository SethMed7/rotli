import { expect, test } from "bun:test";

import { DOCUMENT_EDIT_MAX_BYTES } from "../../documents/kinds";
import { SHEET_EDIT_MAX_BYTES } from "../../sheets/kinds";
import { officeEditability, probeOffice } from "./officeProbe";

const writable = { len: 10, writable: true };

test("Office editability follows build capabilities and writable byte caps", () => {
  expect(officeEditability("document", "docx", writable, { documents: true, sheets: true })).toBe(true);
  expect(officeEditability("document", "docx", writable, { documents: false, sheets: true })).toBe(false);
  expect(officeEditability("sheet", "xlsx", writable, { documents: true, sheets: false })).toBe(false);
  expect(officeEditability("sheet", "xlsx", writable, { documents: true, sheets: true })).toBe(true);
  expect(
    officeEditability(
      "document",
      "docx",
      { ...writable, writable: false },
      { documents: true, sheets: true },
    ),
  ).toBe(false);
  expect(
    officeEditability(
      "document",
      "docx",
      { ...writable, len: DOCUMENT_EDIT_MAX_BYTES + 1 },
      { documents: true, sheets: true },
    ),
  ).toBe(false);
  expect(
    officeEditability(
      "sheet",
      "xlsx",
      { ...writable, len: SHEET_EDIT_MAX_BYTES + 1 },
      { documents: true, sheets: true },
    ),
  ).toBe(false);
});

test("a disabled Office format never reads bytes; an enabled one probes size and location", async () => {
  let reads = 0;
  const ports = {
    stat: async () => writable,
    bytes: async () => {
      reads += 1;
      return "";
    },
    text: async () => {
      reads += 1;
      return "";
    },
    parse: async () => [],
  };
  expect((await probeOffice("document", "docx", ports, { documents: false, sheets: false })).probed).toBe(
    true,
  );
  expect((await probeOffice("sheet", "xlsx", ports, { documents: false, sheets: false })).withheld).toBe(
    true,
  );
  expect(reads).toBe(0);
  expect((await probeOffice("document", "docx", ports, { documents: true, sheets: true })).editable).toBe(
    true,
  );
});
