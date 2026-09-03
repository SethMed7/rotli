// The structured table ops (the maintainer, 2026-07-01) — pure transforms the widget's
// row/col menus, the slash menu's Table insert, and the Tab-appends-a-row
// keymap all dispatch through. These lock: the padded serialization (raw mode
// stays readable), every row/col op, the delimiter's alignment grammar, the
// per-cell source spans (click-to-edit + Tab hopping), and cell navigation.

import { describe, expect, test } from "bun:test";

import { Text } from "@codemirror/state";

import {
  caretAfterTableEdit,
  fitColumnWidths,
  type TableShape,
  addColRight,
  addRowBelow,
  cellSpansOf,
  deleteCol,
  deleteRow,
  insertTableText,
  moveCol,
  moveRow,
  nextCell,
  scanTables,
  setColAlign,
  setCellText,
  splitRow,
  tableToText,
} from "./tables";

const shape = (): TableShape => ({
  header: ["Name", "Age"],
  align: ["", "right"],
  rows: [
    ["Ada", "36"],
    ["Bo", "7"],
  ],
});

/** Round-trip a shape through the serializer and the scanner — the serialized
 * text must parse back to the same cells (offsets aside). */
function reparse(t: TableShape): TableShape {
  const doc = Text.of(`${tableToText(t)}\n`.split("\n"));
  const scanned = scanTables(doc);
  expect(scanned.length).toBe(1);
  const s = scanned[0]!;
  return { header: s.header, align: s.align, rows: s.rows };
}

describe("tableToText", () => {
  test("pads columns to their widest cell so raw mode reads aligned", () => {
    const text = tableToText(shape());
    expect(text).toBe(["| Name | Age |", "| ---- | ---: |", "| Ada  | 36  |", "| Bo   | 7   |"].join("\n"));
  });

  test("round-trips through scanTables (cells + alignment preserved)", () => {
    expect(reparse(shape())).toEqual(shape());
  });

  test("pads short rows to the header's column count, NEVER truncates long ones", () => {
    // truncation was silent data loss (paper-cut sweep 2026-07-27): a ragged-long
    // row (pasted or hand-edited) must keep its overflow cells in the source
    const t: TableShape = { header: ["a", "b"], align: ["", ""], rows: [["only"], ["x", "y", "z"]] };
    expect(reparse(t).rows).toEqual([
      ["only", ""],
      ["x", "y", "z"],
    ]);
  });

  test("keeps every alignment marker in the delimiter row", () => {
    const t: TableShape = {
      header: ["l", "c", "r", "n"],
      align: ["left", "center", "right", ""],
      rows: [],
    };
    expect(reparse(t).align).toEqual(["left", "center", "right", ""]);
  });
});

describe("scanTables + fences (#13)", () => {
  test("a pipe table inside ANY code fence is opaque — never a table block", () => {
    // the SlashMenu repro: a `# h` + pipe-table example inside a plain fence
    const doc = Text.of([
      "```",
      "# h",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "```",
      "",
      "| real | table |",
      "| ---- | ----- |",
      "| x    | y     |",
    ]);
    const tables = scanTables(doc);
    expect(tables.length).toBe(1);
    expect(tables[0]?.header).toEqual(["real", "table"]);
    expect(tables[0]?.from).toBe(doc.line(8).from);
  });
});

describe("escaped pipes (GFM \\|) — paper-cut sweep 2026-07-27", () => {
  test("splitRow treats \\| as cell content, not a separator", () => {
    expect(splitRow("| a \\| b | keepme |")).toEqual(["a | b", "keepme"]);
  });

  test("an escaped backslash before a pipe still separates (\\\\ then |)", () => {
    expect(splitRow("| a \\\\ | b |")).toEqual(["a \\\\", "b"]);
  });

  test("cellSpansOf skips escaped pipes so spans match splitRow's cells", () => {
    const line = "| a \\| b | keepme |";
    const spans = cellSpansOf(line);
    expect(spans.length).toBe(2);
    expect(line.slice(spans[0]!.start, spans[0]!.end)).toBe("a \\| b");
    expect(line.slice(spans[1]!.start, spans[1]!.end)).toBe("keepme");
  });

  test("tableToText escapes pipes typed into a cell — the round-trip is lossless", () => {
    const t: TableShape = { header: ["a", "b"], align: ["", ""], rows: [["5 | 6", "x"]] };
    expect(tableToText(t)).toContain("5 \\| 6");
    expect(reparse(t)).toEqual(t);
  });

  test("a pasted GFM table with \\| survives a row op without losing cells", () => {
    const doc = Text.of(["| cmd | desc |", "| --- | --- |", "| a \\| b | keepme |"]);
    const t = scanTables(doc)[0]!;
    expect(t.rows).toEqual([["a | b", "keepme"]]);
    const after = tableToText(addRowBelow(t, 0));
    expect(after).toContain("keepme");
    expect(after).toContain("a \\| b");
  });
});

describe("delimiter/header cell counts must match (GFM) — paper-cut sweep 2026-07-27", () => {
  test("a bare --- under a piped prose line is NOT a table", () => {
    // "Alpha | Beta" then a --- divider: GFM requires the delimiter row's cell
    // count to equal the header's; otherwise no table exists at all
    expect(scanTables(Text.of(["Alpha | Beta", "---"]))).toEqual([]);
  });

  test("a matching delimiter still forms a table", () => {
    const t = scanTables(Text.of(["Alpha | Beta", "--- | ---"]));
    expect(t.length).toBe(1);
    expect(t[0]!.header).toEqual(["Alpha", "Beta"]);
  });
});

describe("insertTableText", () => {
  test("scaffolds a parseable cols×rows table of empty cells", () => {
    const doc = Text.of(`${insertTableText(3, 2)}\n`.split("\n"));
    const t = scanTables(doc)[0]!;
    expect(t.header).toEqual(["", "", ""]);
    expect(t.rows).toEqual([
      ["", "", ""],
      ["", "", ""],
    ]);
  });
});

describe("row ops", () => {
  test("addRowBelow inserts an empty row after the index (-1 = first)", () => {
    expect(addRowBelow(shape(), 0).rows).toEqual([
      ["Ada", "36"],
      ["", ""],
      ["Bo", "7"],
    ]);
    expect(addRowBelow(shape(), -1).rows[0]).toEqual(["", ""]);
    expect(addRowBelow(shape(), 1).rows[2]).toEqual(["", ""]);
  });

  test("deleteRow removes a data row; out of range is null", () => {
    expect(deleteRow(shape(), 0)?.rows).toEqual([["Bo", "7"]]);
    expect(deleteRow(shape(), 2)).toBeNull();
    expect(deleteRow(shape(), -1)).toBeNull();
  });

  test("moveRow swaps neighbours and refuses the edges", () => {
    expect(moveRow(shape(), 0, 1)?.rows).toEqual([
      ["Bo", "7"],
      ["Ada", "36"],
    ]);
    expect(moveRow(shape(), 0, -1)).toBeNull();
    expect(moveRow(shape(), 1, 1)).toBeNull();
  });
});

describe("column ops", () => {
  test("addColRight inserts an empty column everywhere (-1 = leftmost)", () => {
    const t = addColRight(shape(), 0);
    expect(t.header).toEqual(["Name", "", "Age"]);
    expect(t.align).toEqual(["", "", "right"]);
    expect(t.rows).toEqual([
      ["Ada", "", "36"],
      ["Bo", "", "7"],
    ]);
    expect(addColRight(shape(), -1).header).toEqual(["", "Name", "Age"]);
  });

  test("deleteCol removes the column from header/align/rows; the last column is refused", () => {
    const t = deleteCol(shape(), 0);
    expect(t?.header).toEqual(["Age"]);
    expect(t?.align).toEqual(["right"]);
    expect(t?.rows).toEqual([["36"], ["7"]]);
    expect(deleteCol({ header: ["only"], align: [""], rows: [] }, 0)).toBeNull();
  });

  test("moveCol swaps a column (align travels with it) and refuses the edges", () => {
    const t = moveCol(shape(), 0, 1);
    expect(t?.header).toEqual(["Age", "Name"]);
    expect(t?.align).toEqual(["right", ""]);
    expect(t?.rows[0]).toEqual(["36", "Ada"]);
    expect(moveCol(shape(), 1, 1)).toBeNull();
  });

  test("setColAlign rewrites one delimiter cell", () => {
    const t = setColAlign(shape(), 0, "center");
    expect(t.align).toEqual(["center", "right"]);
    expect(reparse(t).align).toEqual(["center", "right"]);
  });
});

describe("cell editing", () => {
  test("updates header and body cells without changing the table shape", () => {
    expect(setCellText(shape(), -1, 0, "Model")?.header).toEqual(["Model", "Age"]);
    expect(setCellText(shape(), 1, 1, "8")?.rows).toEqual([
      ["Ada", "36"],
      ["Bo", "8"],
    ]);
  });

  test("refuses stale row and column addresses", () => {
    expect(setCellText(shape(), 2, 0, "nope")).toBeNull();
    expect(setCellText(shape(), 0, 2, "nope")).toBeNull();
  });
});

describe("cellSpansOf", () => {
  test("returns each cell's trimmed content span (indices match splitRow)", () => {
    const line = "| Ada  | 36 |";
    const spans = cellSpansOf(line);
    const cells = splitRow(line);
    expect(spans.length).toBe(cells.length);
    expect(spans.map((s) => line.slice(s.start, s.end))).toEqual(cells);
  });

  test("gives an empty cell a caret slot just past its pipe", () => {
    const spans = cellSpansOf("| a |  | c |");
    expect(spans.length).toBe(3);
    const mid = spans[1]!;
    expect(mid.start).toBe(mid.end);
    expect(mid.start).toBe(6); // "| a |·" — right after the pipe
  });

  test("handles rows without edge pipes", () => {
    const line = "a | b";
    const spans = cellSpansOf(line);
    expect(spans.map((s) => line.slice(s.start, s.end))).toEqual(["a", "b"]);
  });
});

describe("nextCell", () => {
  const t = shape(); // 2 cols, header + 2 data rows
  test("walks cells in reading order, crossing rows", () => {
    expect(nextCell(t, { row: -1, col: 0 }, 1)).toEqual({ row: -1, col: 1 });
    expect(nextCell(t, { row: -1, col: 1 }, 1)).toEqual({ row: 0, col: 0 });
    expect(nextCell(t, { row: 0, col: 0 }, -1)).toEqual({ row: -1, col: 1 });
  });
  test("returns null past either end (Tab appends; ⇧Tab stops)", () => {
    expect(nextCell(t, { row: 1, col: 1 }, 1)).toBeNull();
    expect(nextCell(t, { row: -1, col: 0 }, -1)).toBeNull();
  });
});

describe("caretAfterTableEdit", () => {
  const from = 100;
  const insert = "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |";
  test("a caret outside the table lands on the table's first line, not the stale spot", () => {
    expect(caretAfterTableEdit(5000, from, from + 60, insert)).toBe(from);
    expect(caretAfterTableEdit(0, from, from + 60, insert)).toBe(from);
  });
  test("a caret inside the table keeps its line start", () => {
    // "| a | b |" is 9 chars, "| --- | --- |" is 13: the third line starts at 24
    expect(caretAfterTableEdit(from + 26, from, from + 60, insert)).toBe(from + 24);
    expect(caretAfterTableEdit(from + 12, from, from + 60, insert)).toBe(from + 10);
    expect(caretAfterTableEdit(from, from, from + 60, insert)).toBe(from);
  });
  test("a caret past the new (shorter) table clamps to its last line", () => {
    const shorter = "| a |\n| --- |\n| 1 |";
    expect(caretAfterTableEdit(from + 55, from, from + 60, shorter)).toBe(
      from + shorter.lastIndexOf("\n") + 1,
    );
  });
});

describe("fitColumnWidths", () => {
  test("widths that fit are untouched", () => {
    expect(fitColumnWidths([200, 300], 600, 56)).toEqual([200, 300]);
  });
  test("a table wider than its pane scales down proportionally", () => {
    expect(fitColumnWidths([200, 600], 400, 56)).toEqual([100, 300]);
  });
  test("no column drops below the floor even when that means overflow", () => {
    expect(fitColumnWidths([60, 600], 120, 56)).toEqual([56, 109]);
  });
  test("an unknown pane width leaves the widths alone", () => {
    expect(fitColumnWidths([200, 600], 0, 56)).toEqual([200, 600]);
    expect(fitColumnWidths([200, 600], Number.NaN, 56)).toEqual([200, 600]);
  });
});
