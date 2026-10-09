import { expect, test } from "bun:test";

import type { MainNode } from "../../services/mainTree";
import type { NoteSummary } from "../../types";
import { addToFolderMenu, removeFromFolderItem } from "./addToFolderMenu";

const note = (id: string, kind?: NoteSummary["kind"]) => ({ id, kind }) as NoteSummary;
const tree: MainNode[] = [{ note: "a" }, { note: "b" }, { folder: "Bugs", children: [] }];

test("offers every Main folder, then New folder…, and counts a selection in its label", () => {
  const menu = addToFolderMenu({
    tree,
    note: note("a"),
    selection: [note("b"), note("a")],
    setTree: () => {},
    requestRename: () => {},
  });
  if (menu?.kind !== "drill") throw new Error("expected a drill");
  expect(menu.label).toBe("Add 2 items to folder");
  expect(menu.items.map((item) => ("label" in item ? item.label : ""))).toEqual(["Bugs", "New folder…"]);
  const single = addToFolderMenu({ tree, note: note("a"), setTree: () => {}, requestRename: () => {} });
  expect(single && "label" in single ? single.label : "").toBe("Add to folder");
});

test("files in Main's order, skips files, and a new folder is filled then handed over to be named", () => {
  let next: MainNode[] = [];
  let renamed = "";
  const menu = addToFolderMenu({
    tree,
    note: note("b"),
    selection: [note("b"), note("doc.pdf", "file"), note("a")],
    setTree: (t) => (next = t),
    requestRename: (id) => (renamed = id),
  });
  if (menu?.kind !== "drill") throw new Error("expected a drill");
  const fresh = menu.items.at(-1);
  if (fresh?.kind !== "action") throw new Error("expected an action");
  fresh.onClick();
  expect(renamed).toBe("main:New folder");
  expect(next).toEqual([
    { folder: "Bugs", children: [] },
    { folder: "New folder", children: [{ note: "a" }, { note: "b" }] },
  ]);
});

test("a selection the clicked note is not part of is ignored", () => {
  const menu = addToFolderMenu({
    tree,
    note: note("a"),
    selection: [note("b"), note("c")],
    setTree: () => {},
    requestRename: () => {},
  });
  expect(menu && "label" in menu ? menu.label : "").toBe("Add to folder");
});

test("nothing to file (only files) means no menu item", () => {
  expect(
    addToFolderMenu({ tree, note: note("x.pdf", "file"), setTree: () => {}, requestRename: () => {} }),
  ).toBeNull();
});

test("a file already in Main (a new sheet lands there) can move between its folders", () => {
  const inMain: MainNode[] = [
    { folder: "Welcome", children: [{ note: "Sheet one.xlsx" }] },
    { folder: "Bugs", children: [] },
  ];
  let next: MainNode[] = [];
  const menu = addToFolderMenu({
    tree: inMain,
    note: note("Sheet one.xlsx", "file"),
    setTree: (t) => (next = t),
    requestRename: () => {},
  });
  if (menu?.kind !== "drill") throw new Error("expected a drill");
  const bugs = menu.items.find((item) => "label" in item && item.label === "Bugs");
  if (bugs?.kind !== "action") throw new Error("expected Bugs");
  bugs.onClick();
  expect(next).toEqual([
    { folder: "Welcome", children: [] },
    { folder: "Bugs", children: [{ note: "Sheet one.xlsx" }] },
  ]);
});

test("Remove from folder lifts the note — or the gathered selection — out to the top level", () => {
  const inFolder: MainNode[] = [{ folder: "Welcome", children: [{ note: "a" }, { note: "Sheet one.xlsx" }] }];
  let next: MainNode[] = [];
  const item = removeFromFolderItem({ tree: inFolder, note: note("a"), setTree: (t) => (next = t) });
  if (item?.kind !== "action") throw new Error("expected an action");
  expect(item.label).toBe("Remove from folder");
  item.onClick();
  expect(next).toEqual([{ folder: "Welcome", children: [{ note: "Sheet one.xlsx" }] }, { note: "a" }]);

  const both = removeFromFolderItem({
    tree: inFolder,
    note: note("a"),
    selection: [note("a"), note("Sheet one.xlsx", "file")],
    setTree: (t) => (next = t),
  });
  if (both?.kind !== "action") throw new Error("expected an action");
  expect(both.label).toBe("Remove 2 items from folder");
  both.onClick();
  // they land in the order Main listed them
  expect(next).toEqual([{ folder: "Welcome", children: [] }, { note: "a" }, { note: "Sheet one.xlsx" }]);
});

test("nothing in a folder means no Remove from folder", () => {
  const top: MainNode[] = [{ note: "a" }, { folder: "Welcome", children: [] }];
  expect(removeFromFolderItem({ tree: top, note: note("a"), setTree: () => {} })).toBeNull();
  expect(removeFromFolderItem({ tree: top, note: note("elsewhere"), setTree: () => {} })).toBeNull();
});
