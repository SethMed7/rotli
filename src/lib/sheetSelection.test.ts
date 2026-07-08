import { describe, expect, test } from "bun:test";
import {
  type Sel,
  activeCell,
  cellSel,
  rangeBounds,
  rangeCells,
  selHas,
  toggleCell,
} from "./sheetSelection";

type Range = Extract<Sel, { kind: "range" }>;
const range = (partial: Omit<Range, "kind" | "extra" | "holes"> & Partial<Range>): Range => ({
  kind: "range",
  extra: [],
  holes: [],
  ...partial,
});

describe("sheet selection", () => {
  test("cellSel is a one-cell range whose active cell is itself", () => {
    const s = cellSel(2, 3);
    expect(activeCell(s)).toEqual({ r: 2, c: 3 });
    expect(rangeCells(s as Range)).toEqual([{ r: 2, c: 3 }]);
  });

  test("rangeBounds normalizes a bottom-right → top-left drag", () => {
    expect(rangeBounds({ r: 4, c: 5 }, { r: 1, c: 2 })).toEqual({ r1: 1, r2: 4, c1: 2, c2: 5 });
  });

  test("rangeCells expands a rectangle in row-major order", () => {
    const s = range({ anchor: { r: 0, c: 0 }, focus: { r: 1, c: 1 } });
    expect(rangeCells(s)).toEqual([
      { r: 0, c: 0 },
      { r: 0, c: 1 },
      { r: 1, c: 0 },
      { r: 1, c: 1 },
    ]);
  });

  test("rangeCells adds discontiguous extra cells but never double-counts one inside the rect", () => {
    const s = range({
      anchor: { r: 0, c: 0 },
      focus: { r: 0, c: 1 },
      extra: [
        { r: 5, c: 5 }, // outside → added
        { r: 0, c: 1 }, // inside the rect → not duplicated
      ],
    });
    expect(rangeCells(s)).toEqual([{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 5, c: 5 }]);
  });

  test("holes punch cells out of the rectangle (selHas + rangeCells agree)", () => {
    const s = range({ anchor: { r: 0, c: 0 }, focus: { r: 1, c: 1 }, holes: [{ r: 0, c: 1 }] });
    expect(selHas(s, 0, 1)).toBe(false);
    expect(selHas(s, 1, 1)).toBe(true);
    expect(rangeCells(s)).toEqual([{ r: 0, c: 0 }, { r: 1, c: 0 }, { r: 1, c: 1 }]);
  });

  test("toggleCell: inside the rect toggles a hole, outside toggles an extra, both round-trip", () => {
    const s = range({ anchor: { r: 0, c: 0 }, focus: { r: 1, c: 1 } });
    const holed = toggleCell(s, 0, 1) as Range;
    expect(holed.holes).toEqual([{ r: 0, c: 1 }]);
    expect((toggleCell(holed, 0, 1) as Range).holes).toEqual([]); // re-click restores
    const extended = toggleCell(s, 9, 9) as Range;
    expect(extended.extra).toEqual([{ r: 9, c: 9 }]);
    expect((toggleCell(extended, 9, 9) as Range).extra).toEqual([]);
  });

  test("toggleCell scrubs the opposite list — a stale hole can't undo a later re-add", () => {
    // hole B2 inside a big rect, shrink the rect past it, ⌘-add it back as an
    // extra (must also SCRUB the stale hole), then extend the rect over it again
    const big = range({ anchor: { r: 0, c: 0 }, focus: { r: 2, c: 2 } });
    const holed = toggleCell(big, 1, 1) as Range; // B2 → hole
    const shrunk = { ...holed, focus: { r: 0, c: 0 } }; // B2 now outside the rect
    const readded = toggleCell(shrunk, 1, 1) as Range; // ⌘-add as extra
    expect(readded.extra).toEqual([{ r: 1, c: 1 }]);
    expect(readded.holes).toEqual([]); // the stale hole was scrubbed
    const extended = { ...readded, focus: { r: 2, c: 2 } }; // rect covers B2 again
    expect(selHas(extended, 1, 1)).toBe(true); // the re-add survives
  });

  test("selHas covers the rectangle, the extras, and a whole column", () => {
    const r = range({ anchor: { r: 1, c: 1 }, focus: { r: 2, c: 2 }, extra: [{ r: 9, c: 9 }] });
    expect(selHas(r, 1, 2)).toBe(true); // in rect
    expect(selHas(r, 9, 9)).toBe(true); // extra
    expect(selHas(r, 3, 3)).toBe(false); // outside
    const col: Sel = { kind: "col", c: 4 };
    expect(selHas(col, 0, 4)).toBe(true);
    expect(selHas(col, 0, 5)).toBe(false);
    expect(selHas(null, 0, 0)).toBe(false);
  });

  test("activeCell is null for a column selection", () => {
    expect(activeCell({ kind: "col", c: 3 })).toBeNull();
  });
});
