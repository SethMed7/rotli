import { expect, test } from "bun:test";

import type { PaneNode } from "../types";
import { durablePane } from "./viewstate";

test("nested pane snapshots exclude browser identity without mutating live tabs", () => {
  const root: PaneNode = {
    kind: "split",
    id: "root",
    dir: "row",
    sizes: [0.5, 0.5],
    children: [
      {
        kind: "leaf",
        id: "left",
        activeTabId: "scratch",
        tabs: [
          { id: "scratch", surfaceKind: "browser" },
          { id: "note", surfaceKind: "note", noteId: "user-file" },
        ],
      },
      {
        kind: "leaf",
        id: "right",
        activeTabId: "private",
        tabs: [{ id: "private", surfaceKind: "browser" }],
      },
    ],
  };
  const snapshot = durablePane(root);
  expect(JSON.stringify(snapshot)).not.toContain("scratch");
  expect(JSON.stringify(snapshot)).not.toContain("private");
  expect(snapshot.kind === "split" && snapshot.children[0]).toMatchObject({ activeTabId: "note" });
  expect(snapshot.kind === "split" && snapshot.children[1]).toMatchObject({ tabs: [], activeTabId: "" });
  expect(JSON.stringify(root)).toContain("scratch");
});
