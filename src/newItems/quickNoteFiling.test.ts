import { afterEach, expect, test } from "bun:test";

import { MAIN_ROOT, mainNoteIds } from "../services/mainTree";
import { useMainStore } from "../state/main";
import { createManagedItem, fileQuickNoteInMain, refuseWithheldKind } from "./composition";

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

test("a withheld kind is refused before any file is created; available kinds pass", async () => {
  // bun test compiles as the stable channel
  expect(() => refuseWithheldKind("sheet")).toThrow("Sheet isn’t available in this build yet");
  expect(() => refuseWithheldKind("mermaid")).toThrow("Mermaid diagram isn’t available in this build yet");
  expect(() => refuseWithheldKind("markdown")).not.toThrow();
  await expect(createManagedItem("sheet")).rejects.toThrow("isn’t available");
});
