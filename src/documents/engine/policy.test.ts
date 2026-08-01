import { describe, expect, test } from "bun:test";

import { documentInsertionRange, documentTableRanges, isDocumentContentMutation } from "./policy";

describe("DOCX Univer adapter policy", () => {
  test("marks content mutations dirty but ignores zoom operations", () => {
    expect(isDocumentContentMutation({ id: "doc.mutation.edit", type: 2 })).toBe(true);
    expect(isDocumentContentMutation({ id: "doc.operation.set-zoom", type: 1 })).toBe(false);
  });

  test("captures a stable insertion range before a table dialog takes focus", () => {
    expect(
      documentInsertionRange("doc-1", {
        startOffset: 8,
        endOffset: 8,
        segmentId: "body",
      }),
    ).toEqual({
      unitId: "doc-1",
      startOffset: 8,
      endOffset: 8,
      segmentId: "body",
    });
    expect(documentInsertionRange("doc-1", null)).toBeNull();
  });

  test("recovers table ranges when Univer omits body.tables", () => {
    expect(documentTableRanges("before\r\x1a\x1b\x1c\r\n\x1d\x0e\x0fafter\r\n", [], ["table-1"])).toEqual([
      { startIndex: 7, endIndex: 15, tableId: "table-1" },
    ]);
  });
});
