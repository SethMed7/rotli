// The structured table ops (Seth, 2026-07-01) — pure transforms the widget's
// row/col menus, the slash menu's Table insert, and the Tab-appends-a-row
// keymap all dispatch through. These lock: the padded serialization (raw mode
// stays readable), every row/col op, the delimiter's alignment grammar, the
// per-cell source spans (click-to-edit + Tab hopping), and cell navigation.

import { describe, expect, test } from "bun:test";
import { Text } from "@codemirror/state";
import {
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

  test("normalizes ragged rows to the header's column count", () => {
    const t: TableShape = { header: ["a", "b"], align: ["", ""], rows: [["only"], ["x", "y", "z"]] };
    expect(reparse(t).rows).toEqual([
      ["only", ""],
      ["x", "y"],
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
