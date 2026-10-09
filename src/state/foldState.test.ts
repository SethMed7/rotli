import { expect, test } from "bun:test";

import type { NoteSummary } from "../types";
import { foldStateKeeper } from "./foldState";

const note = (id: string, diskFolderId: string): NoteSummary => ({
  id,
  title: id,
  snippet: "",
  folderId: diskFolderId,
  diskFolderId,
  createdAt: 0,
  updatedAt: 0,
  pinned: false,
});

const folders = [
  { id: "wiki", name: "wiki", parentId: null },
  { id: "wiki/_inbox", name: "_inbox", parentId: "wiki" },
  { id: "wiki/Clients", name: "Clients", parentId: "wiki" },
  { id: "wiki/Clients/Acme", name: "Acme", parentId: "wiki/Clients" },
];

test("a Vault view folder someone opened stays open across a launch", () => {
  const keep = foldStateKeeper(folders, [], [note("n1", "wiki/_inbox"), note("n2", "wiki/Clients/Acme")]);
  expect(keep("main:_inbox")).toBe(true);
  expect(keep("main:Clients")).toBe(true);
  expect(keep("main:Clients/Acme")).toBe(true);
});

test("a Main folder, a reserved row, and a zone keep their state; a gone folder's key goes", () => {
  const keep = foldStateKeeper(folders, [{ folder: "Work", children: [] }], []);
  expect(keep("main:Work")).toBe(true);
  expect(keep("Inbox")).toBe(true);
  expect(keep("sec:system")).toBe(true);
  expect(keep("wiki/Clients")).toBe(true);
  expect(keep("main:Gone")).toBe(false);
});
