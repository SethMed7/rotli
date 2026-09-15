import { describe, expect, test } from "bun:test";

import { plainTabRule, selectionSpan, wholeDocumentRange, widenToDocument, type TabContext } from "./keys";

const ids = {
  tab: "doc.command.tab",
  insertText: "doc.command.insert-text",
  selectAll: "doc.command.select-all",
  undo: "univer.command.undo",
  redo: "univer.command.redo",
};

function context(overrides: Partial<TabContext>): TabContext {
  return {
    selection: { startOffset: 5, endOffset: 5, collapsed: true },
    commandParams: null,
    ...overrides,
  };
}

describe("document Tab in an ordinary paragraph", () => {
  test("ranks below Univer's list nesting (100) and table-cell move (99)", () => {
    const rule = plainTabRule(ids, "doc");
    expect(rule.id).toBe(ids.tab);
    expect(rule.priority).toBeLessThan(99);
  });

  test("Tab inserts a tab character at the selection; Shift+Tab does not", () => {
    const rule = plainTabRule(ids, "doc");
    expect(rule.match(context({}))).toBe(true);
    expect(rule.match(context({ commandParams: { shift: true } }))).toBe(false);
    expect(rule.getMutations(context({}))).toEqual([
      {
        id: ids.insertText,
        params: {
          unitId: "doc",
          body: { dataStream: "\t" },
          range: { startOffset: 5, endOffset: 5, collapsed: true },
        },
      },
    ]);
  });

  test("a tab typed in a header or footer keeps its segment", () => {
    const rule = plainTabRule(ids, "doc");
    const [mutation] = rule.getMutations(
      context({ selection: { startOffset: 0, endOffset: 0, collapsed: true, segmentId: "header-1" } }),
    );
    expect((mutation?.params as { segmentId?: string } | undefined)?.segmentId).toBe("header-1");
  });
});

describe("one Select All takes the whole document", () => {
  // Univer's own toggle: a caret press selects its paragraph; pressing again
  // with that exact selection takes the whole document, and vice versa.
  function univerToggle(documentSpan: number, paragraphSpan: number, start: number) {
    let span = start;
    return {
      run: () => {
        span = span === paragraphSpan ? documentSpan : paragraphSpan;
      },
      span: () => span,
    };
  }

  test("a caret press that selected only its paragraph widens to the document", async () => {
    const univer = univerToggle(120, 20, 0);
    univer.run(); // Univer's own ⌘A
    await widenToDocument(univer.run, univer.span);
    expect(univer.span()).toBe(120);
  });

  test("a press that already had the document keeps it", async () => {
    const univer = univerToggle(120, 20, 20);
    univer.run(); // the paragraph was selected, so Univer took the document
    await widenToDocument(univer.run, univer.span);
    expect(univer.span()).toBe(120);
  });

  test("selection span runs from the first offset to the last", () => {
    expect(selectionSpan([])).toBe(0);
    expect(
      selectionSpan([
        { startOffset: 7, endOffset: 30 },
        { startOffset: 40, endOffset: 90 },
      ]),
    ).toBe(83);
  });

  test("a text-only document is selected as one range so typing replaces all of it", () => {
    expect(wholeDocumentRange({ dataStream: "Plain\rSecond paragraph\r\n" })).toEqual({
      startOffset: 0,
      endOffset: 22,
    });
    expect(wholeDocumentRange({ dataStream: "\r\n" })).toEqual({ startOffset: 0, endOffset: 0 });
  });

  test("a document with a table keeps Univer's table-aware ranges", () => {
    expect(
      wholeDocumentRange({
        dataStream: "a\r\x1a\x1b\x1c\r\n\x1d\x0e\x0f\r\n",
        tables: [{ startIndex: 2, endIndex: 11, tableId: "t" }],
      }),
    ).toBeNull();
    expect(wholeDocumentRange({ dataStream: "a\r\x1a\x1b\x1c\r\n\x1d\x0e\x0f\r\n" })).toBeNull();
    expect(wholeDocumentRange(null)).toBeNull();
  });
});
