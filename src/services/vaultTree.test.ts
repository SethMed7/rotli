import { expect, test } from "bun:test";

import type { NoteSummary } from "../types";
import { vaultTree } from "./vaultTree";

const note = (id: string, title: string, diskFolderId: string, folderId = diskFolderId): NoteSummary => ({
  id,
  title,
  snippet: "",
  folderId,
  diskFolderId,
  createdAt: 0,
  updatedAt: 0,
  pinned: false,
});

test("the Vault view is the vault's folders as on disk: folders first, then files, by name", () => {
  const tree = vaultTree(
    [
      note("n3", "zebra", "wiki"),
      note("n1", "Plan 10", "wiki/Projects/Rotli"),
      note("n2", "Plan 2", "wiki/Projects/Rotli"),
      note("n4", "Gone", "Trash", "Trash"),
      note("n5", "Old", "Archive/2025", "Archive"),
    ],
    [
      { id: "wiki", name: "wiki", parentId: null },
      { id: "wiki/Empty", name: "Empty", parentId: "wiki" },
      { id: "wiki/.cache", name: ".cache", parentId: "wiki" },
      { id: "Trash", name: "Trash", parentId: null },
    ],
  );
  expect(tree).toEqual([
    { folder: "Empty", children: [] },
    { folder: "Projects", children: [{ folder: "Rotli", children: [{ note: "n2" }, { note: "n1" }] }] },
    { note: "n3" },
  ]);
});

test("a folder reads by its names, and the external vault's markers stay out", () => {
  expect(
    vaultTree(
      [],
      [
        { id: "wiki", name: "wiki", parentId: null },
        { id: "01ABC", name: "Work", parentId: "wiki" },
        { id: "vault:wiki", name: "wiki", parentId: null },
      ],
    ),
  ).toEqual([{ folder: "Work", children: [] }]);
});

test("a plain folder vault is rooted at itself", () => {
  expect(vaultTree([note("a", "A", "Inbox"), note("b", "B", "")])).toEqual([
    { folder: "Inbox", children: [{ note: "a" }] },
    { note: "b" },
  ]);
});

test("the reserved destination rows a folder list carries are not folders on disk, so they stay out", () => {
  // Rotli Web's folder list leads with the destinations (Inbox, Secure notes, Storage, Board): ids
  // that are names, not paths. A real folder of the same name is a path and still shows.
  const tree = vaultTree(
    [note("n1", "call w/ dana", "wiki/_inbox")],
    [
      { id: "Inbox", name: "Inbox", parentId: null },
      { id: "Secure notes", name: "Secure notes", parentId: null },
      { id: "Storage", name: "Storage", parentId: null },
      { id: "Board", name: "Board", parentId: null },
      { id: "wiki", name: "wiki", parentId: null },
      { id: "wiki/_inbox", name: "_inbox", parentId: "wiki" },
      { id: "wiki/Inbox", name: "Inbox", parentId: "wiki" },
    ],
  );
  expect(tree).toEqual([
    { folder: "_inbox", children: [{ note: "n1" }] },
    { folder: "Inbox", children: [] },
  ]);
});
