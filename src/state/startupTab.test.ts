import { expect, test } from "bun:test";

import { usePanesStore } from "./panes";
import { onlyPlaceholderTab, placeholderFill } from "./startupTab";

test("the placeholder opens the freshest note, skipping boards, or nothing in an empty vault", () => {
  expect(placeholderFill([{ id: "b1", kind: "board" }, { id: "n1" }, { id: "n2" }])).toEqual({ open: "n1" });
  expect(placeholderFill([{ id: "b1", kind: "board" }])).toEqual({ open: null });
  expect(placeholderFill([])).toEqual({ open: null });
});

test("only the untouched startup placeholder counts, never a note the person opened", () => {
  const leaf = { kind: "leaf" as const, id: "p1", activeTabId: "t1" };
  usePanesStore.setState({
    root: { ...leaf, tabs: [{ id: "t1", surfaceKind: "note", noteId: "" }] } as never,
    focusedPaneId: "p1",
  });
  expect(onlyPlaceholderTab()).toBe(true);
  usePanesStore.setState({
    root: { ...leaf, tabs: [{ id: "t1", surfaceKind: "note", noteId: "n7" }] } as never,
  });
  expect(onlyPlaceholderTab()).toBe(false);
});
