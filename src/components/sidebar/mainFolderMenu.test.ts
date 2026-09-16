import { expect, test } from "bun:test";

import { EMPTY_VIEWS } from "../../services/viewTree";
import type { NoteSummary } from "../../types";
import { type MainFolderMenuInput, mainFolderMenuItems } from "./mainFolderMenu";

const note = (id: string): NoteSummary => ({
  id,
  title: id,
  snippet: "",
  folderId: "main:Review",
  createdAt: 1,
  updatedAt: 1,
  pinned: false,
});

function input(over: Partial<MainFolderMenuInput> = {}): MainFolderMenuInput {
  return {
    folder: { id: "main:Review", name: "Review", parentId: "main:" },
    folderItems: [],
    folderScopeComplete: true,
    views: EMPTY_VIEWS,
    activeView: null,
    mainTree: [{ folder: "Review", children: [] }],
    activeTree: [{ folder: "Review", children: [] }],
    liveIds: undefined,
    rename: () => {},
    setViews: () => {},
    setActiveTree: () => {},
    trashItems: () => {},
    ...over,
  };
}

const labels = (items: ReturnType<typeof mainFolderMenuItems>) =>
  items.map((item) => ("label" in item ? item.label : "—"));

test("an empty folder offers a direct Delete folder that removes it from the tree", () => {
  let removed = false;
  const items = mainFolderMenuItems(input({ setActiveTree: (tree) => (removed = tree.length === 0) }));
  expect(labels(items)).toEqual(["Rename folder…", "—", "Remove from Main", "—", "Delete folder"]);
  const del = items[items.length - 1];
  if (del?.kind !== "action") throw new Error("expected an action");
  del.onClick();
  expect(removed).toBe(true);
});

test("a full folder deletes through Trash: items first, then the folder", () => {
  const calls: string[] = [];
  const items = mainFolderMenuItems(
    input({
      folderItems: [note("a"), note("b")],
      trashItems: (list, onSuccess) => {
        calls.push(`trash:${list.map((n) => n.id).join(",")}`);
        onSuccess();
      },
      setActiveTree: () => calls.push("remove-folder"),
    }),
  );
  const drill = items[items.length - 1];
  if (drill?.kind !== "drill") throw new Error("expected a drill");
  expect(drill.label).toBe("Delete folder…");
  expect(drill.disabled).toBe(false);
  const action = drill.items[0];
  if (action?.kind !== "action") throw new Error("expected an action");
  expect(action.label).toBe("Move 2 items to Trash and delete folder");
  action.onClick();
  expect(calls).toEqual(["trash:a,b", "remove-folder"]);
});

test("a folder with items the index cannot see refuses to delete blind", () => {
  const items = mainFolderMenuItems(input({ folderItems: [note("a")], folderScopeComplete: false }));
  const drill = items[items.length - 1];
  if (drill?.kind !== "drill") throw new Error("expected a drill");
  expect(drill.disabled).toBe(true);
  expect(drill.label).toBe("Unavailable items — can’t delete folder");
});

test("named views add Move to view with the current one highlighted", () => {
  const items = mainFolderMenuItems(
    input({ views: { version: 1, views: [{ name: "Research", tree: [] }] }, activeView: "Research" }),
  );
  const drill = items[1];
  if (drill?.kind !== "drill") throw new Error("expected a drill");
  expect(drill.items.map((i) => ("label" in i ? i.label : "—"))).toEqual(["Main only", "Research"]);
  expect(labels(items)).toContain("Remove from Research");
});
