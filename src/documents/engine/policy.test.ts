import { describe, expect, test } from "bun:test";

import { documentInsertionRange, documentTableRanges, isDocumentContentMutation } from "./policy";

describe("DOCX Univer adapter policy", () => {
  test("marks content mutations dirty but ignores zoom operations", () => {
    expect(isDocumentContentMutation({ id: "doc.mutation.edit", type: 2 })).toBe(true);
    expect(isDocumentContentMutation({ id: "doc.operation.set-zoom", type: 1 })).toBe(false);
  });

  test("a format chosen at a collapsed caret is pending style, not a content mutation", () => {
    // Univer arms the caret's style cache and still dispatches a no-op
    // rich-text mutation. Treating it as content re-laid the canvas, which
    // refreshed the selection and cleared the pending style before typing.
    const caretOnly = { id: "doc.mutation.rich-text-editing", type: 2 };
    expect(isDocumentContentMutation({ ...caretOnly, params: { actions: null } })).toBe(false);
    expect(isDocumentContentMutation({ ...caretOnly, params: { actions: [] } })).toBe(false);
    expect(
      isDocumentContentMutation({ ...caretOnly, params: { actions: ["body", { et: "text-x", e: [] }] } }),
    ).toBe(true);
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
