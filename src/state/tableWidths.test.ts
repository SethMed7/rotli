import { describe, expect, test } from "bun:test";
import { MIN_TABLE_COL_PX, noteIdOfWidthKey, tableWidthKey, useTableWidthsStore } from "./tableWidths";

describe("table column widths (per-note view state)", () => {
  test("keys round-trip the note id and survive odd signatures", () => {
    const key = tableWidthKey("01NOTE", "Order|Item|Why deferred#0");
    expect(noteIdOfWidthKey(key)).toBe("01NOTE");
    expect(noteIdOfWidthKey(tableWidthKey("vault:wiki/my note.md", "a b#1"))).toBe("vault:wiki/my note.md");
  });

  test("set clamps to the minimum, rounds, and null clears", () => {
    const key = tableWidthKey("n", "h#0");
    useTableWidthsStore.getState().setTableWidths(key, [10, 240.6, 300]);
    expect(useTableWidthsStore.getState().widths[key]).toEqual([MIN_TABLE_COL_PX, 241, 300]);
    useTableWidthsStore.getState().setTableWidths(key, null);
    expect(useTableWidthsStore.getState().widths[key]).toBeUndefined();
  });
});
