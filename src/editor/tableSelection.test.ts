import { expect, test } from "bun:test";

import type { TableShape } from "./tables";
import { cellRectangle, clearCells, selectionTsv, toggleCell } from "./tableSelection";

const shape: TableShape = {
  header: ["A", "B", "C"],
  align: ["", "", ""],
  rows: [
    ["1", "2<br>x", "3"],
    ["4", "5", "6"],
  ],
};

test("a rectangle spans both corners in either direction, header row included", () => {
  expect(cellRectangle({ row: 1, col: 2 }, { row: -1, col: 1 }).map((c) => `${c.row}:${c.col}`)).toEqual([
    "-1:1",
    "-1:2",
    "0:1",
    "0:2",
    "1:1",
    "1:2",
  ]);
});

test("toggling adds an unselected cell and removes a selected one", () => {
  const one = toggleCell([], { row: 0, col: 0 });
  expect(one).toEqual([{ row: 0, col: 0 }]);
  expect(toggleCell(one, { row: 0, col: 0 })).toEqual([]);
  expect(toggleCell(one, { row: 1, col: 1 })).toHaveLength(2);
});

test("copy writes reading-order TSV with gaps empty and breaks flattened", () => {
  expect(
    selectionTsv(shape, [
      { row: 1, col: 2 },
      { row: 0, col: 1 },
      { row: 0, col: 2 },
    ]),
  ).toBe("2 x\t3\n\t6");
  expect(selectionTsv(shape, [])).toBe("");
});

test("clearing empties every selected cell in one shape and skips stale addresses", () => {
  const next = clearCells(shape, [
    { row: -1, col: 0 },
    { row: 1, col: 1 },
    { row: 9, col: 9 },
  ]);
  expect(next.header).toEqual(["", "B", "C"]);
  expect(next.rows).toEqual([
    ["1", "2<br>x", "3"],
    ["4", "", "6"],
  ]);
});
