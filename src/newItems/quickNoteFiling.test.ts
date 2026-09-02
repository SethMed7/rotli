import { afterEach, expect, test } from "bun:test";

import { MAIN_ROOT, mainNoteIds } from "../services/mainTree";
import { useMainStore } from "../state/main";
import { fileQuickNoteInMain } from "./composition";

afterEach(() => useMainStore.setState({ manifest: { version: 1, tree: [] } }));

test("a newborn Quick Note is filed into Main's root, which is what keeps it out of Captures", () => {
  useMainStore.setState({ manifest: { version: 1, tree: [] } });
  fileQuickNoteInMain("01QUICKNOTE0000000000000000");
  const tree = useMainStore.getState().manifest.tree;
  expect(mainNoteIds(tree).has("01QUICKNOTE0000000000000000")).toBe(true);
  // root placement — a quick note comes from anywhere, so Main's root is its
  // honest home rather than whatever folder happened to be selected
  expect(tree.some((node) => "note" in node && node.note === "01QUICKNOTE0000000000000000")).toBe(true);
  expect(MAIN_ROOT).toBe("main:");
});

test("filing the same quick note twice does not duplicate its reference", () => {
  useMainStore.setState({ manifest: { version: 1, tree: [] } });
  fileQuickNoteInMain("01QUICKNOTE0000000000000001");
  fileQuickNoteInMain("01QUICKNOTE0000000000000001");
  const ids = useMainStore
    .getState()
    .manifest.tree.filter((node) => "note" in node && node.note === "01QUICKNOTE0000000000000001");
  expect(ids).toHaveLength(1);
});
