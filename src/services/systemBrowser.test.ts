// System-browser locks (Finder rework 2026-07-27, the maintainer's screenshots): the
// browser is SPATIAL — you are IN one folder and see only its direct contents
// (subfolders as folders, notes as items), you enter folders and climb back by
// breadcrumb, empty directories are real, and search flattens across the root.

import { describe, expect, test } from "bun:test";

import type { NoteSummary } from "../types";
import {
  breadcrumbOf,
  filterSystemItems,
  folderSegmentLabel,
  kindLabel,
  listFolderContents,
  rerootDiskPath,
  sortFolderListing,
} from "./systemBrowser";

const note = (over: Partial<NoteSummary>): NoteSummary => ({
  id: "n1",
  title: "A note",
  snippet: "words",
  folderId: "wiki/Projects",
  createdAt: 1,
  updatedAt: 10,
  pinned: false,
  ...over,
});

describe("listFolderContents", () => {
  const items = [
    note({ id: "a", title: "Alpha", folderId: "wiki", updatedAt: 30 }),
    note({ id: "b", title: "Beta", folderId: "wiki/Projects", updatedAt: 20 }),
    note({ id: "c", title: "Gamma", folderId: "wiki/Projects/rotli", updatedAt: 40 }),
    note({ id: "d", title: "Delta", folderId: "wiki/Research", updatedAt: 10 }),
  ];

  test("shows only the cwd's DIRECT contents — subfolders and loose items", () => {
    const l = listFolderContents(items, "wiki");
    expect(l.folders.map((f) => f.path)).toEqual(["wiki/Projects", "wiki/Research"]);
    expect(l.items.map((n) => n.id)).toEqual(["a"]);
  });

  test("a subtree's notes roll up into its folder's count and Date Modified", () => {
    const l = listFolderContents(items, "wiki");
    const projects = l.folders[0]!;
    expect(projects.itemCount).toBe(2); // Beta + Gamma (nested)
    expect(projects.updatedAt).toBe(40); // Gamma is the freshest inside
  });

  test("entering a folder shows ITS contents, including deeper subfolders", () => {
    const l = listFolderContents(items, "wiki/Projects");
    expect(l.folders.map((f) => f.name)).toEqual(["rotli"]);
    expect(l.items.map((n) => n.id)).toEqual(["b"]);
  });

  test("seeded empty directories are real folders with a null Date Modified", () => {
    const l = listFolderContents(items, "wiki", ["wiki/People"]);
    const people = l.folders.find((f) => f.path === "wiki/People");
    expect(people).toBeDefined();
    expect(people?.itemCount).toBe(0);
    expect(people?.updatedAt).toBeNull();
  });

  test("a deep seed also creates its intermediate folders", () => {
    const l = listFolderContents([], "wiki", ["wiki/People/Family"]);
    expect(l.folders.map((f) => f.path)).toEqual(["wiki/People"]);
    const inside = listFolderContents([], "wiki/People", ["wiki/People/Family"]);
    expect(inside.folders.map((f) => f.name)).toEqual(["Family"]);
  });

  test("folder names humanize internal segments", () => {
    const l = listFolderContents([note({ id: "s", folderId: "wiki/_secure" })], "wiki");
    expect(l.folders.map((f) => f.name)).toEqual(["Secure notes"]);
  });

  test("default order is Finder's: folders and items each name-ascending", () => {
    const l = listFolderContents(
      [
        note({ id: "z", title: "Zed", folderId: "wiki" }),
        note({ id: "a2", title: "Aardvark", folderId: "wiki" }),
      ],
      "wiki",
    );
    expect(l.items.map((n) => n.title)).toEqual(["Aardvark", "Zed"]);
  });
});

describe("sortFolderListing", () => {
  const l = listFolderContents(
    [
      note({ id: "old", title: "Old", folderId: "wiki", updatedAt: 1 }),
      note({ id: "new", title: "New", folderId: "wiki", updatedAt: 9 }),
      note({ id: "x", title: "X", folderId: "wiki/B", updatedAt: 5 }),
      note({ id: "y", title: "Y", folderId: "wiki/A", updatedAt: 7 }),
    ],
    "wiki",
  );

  test("by date puts the freshest first (folders by their subtree date)", () => {
    const s = sortFolderListing(l, "date", -1);
    expect(s.items.map((n) => n.id)).toEqual(["new", "old"]);
    expect(s.folders.map((f) => f.path)).toEqual(["wiki/A", "wiki/B"]);
  });

  test("by name ascending is the default shape (stable round-trip)", () => {
    const s = sortFolderListing(l, "name", 1);
    expect(s.items.map((n) => n.title)).toEqual(["New", "Old"]);
    expect(s.folders.map((f) => f.path)).toEqual(["wiki/A", "wiki/B"]);
  });
});

describe("breadcrumbOf", () => {
  test("the root crumb carries the browser title", () => {
    expect(breadcrumbOf("wiki", "wiki", "Library")).toEqual([{ path: "wiki", label: "Library" }]);
  });

  test("deeper crumbs humanize each segment and keep full paths", () => {
    expect(breadcrumbOf("wiki/Projects/rotli", "wiki", "Library")).toEqual([
      { path: "wiki", label: "Library" },
      { path: "wiki/Projects", label: "Projects" },
      { path: "wiki/Projects/rotli", label: "rotli" },
    ]);
  });
});

describe("kindLabel", () => {
  test("mirrors Finder's Kind column, extension-aware for files", () => {
    expect(kindLabel(note({}))).toBe("Note");
    expect(kindLabel(note({ kind: "board" }))).toBe("Board");
    expect(kindLabel(note({ kind: "file", id: "storage/ref.pdf" }))).toBe("PDF");
    expect(kindLabel(note({ kind: "file", id: "storage/pic.PNG" }))).toBe("PNG image");
    expect(kindLabel(note({ kind: "file", id: "storage/data.parquet" }))).toBe("PARQUET file");
  });
});

describe("filterSystemItems (search flattens across the root)", () => {
  test("matches title or snippet, pinned first then recency", () => {
    const hits = filterSystemItems(
      [
        note({ id: "a", title: "Launch plan", updatedAt: 5 }),
        note({ id: "b", snippet: "launch checklist", updatedAt: 9 }),
        note({ id: "c", title: "Unrelated", snippet: "nope" }),
      ],
      "launch",
    );
    expect(hits.map((n) => n.id)).toEqual(["b", "a"]);
  });
});

describe("folderSegmentLabel", () => {
  test("internal names get display names", () => {
    expect(folderSegmentLabel("_secure")).toBe("Secure notes");
    expect(folderSegmentLabel("_inbox")).toBe("Captures");
    expect(folderSegmentLabel("Storage")).toBe("Assets");
    expect(folderSegmentLabel("Projects")).toBe("Projects");
  });
});

describe("rerootDiskPath (the 422-count-but-empty-Assets bug, 2026-07-28)", () => {
  test("a path already under the prefix passes through", () => {
    expect(rerootDiskPath("Storage", "Storage")).toBe("Storage");
    expect(rerootDiskPath("Storage/chats", "Storage")).toBe("Storage/chats");
  });

  test("a memex's lowercase lane re-roots onto the destination prefix", () => {
    expect(rerootDiskPath("storage", "Storage")).toBe("Storage");
    expect(rerootDiskPath("storage/chats/x", "Storage")).toBe("Storage/chats/x");
    expect(rerootDiskPath("trash/wiki/projects", "Trash")).toBe("Trash/wiki/projects");
  });

  test("a foreign path surfaces AT the root rather than vanishing", () => {
    expect(rerootDiskPath("wiki/Projects", "Storage")).toBe("Storage");
  });

  test("a prefix-named sibling lane is NOT swallowed by startsWith", () => {
    expect(rerootDiskPath("StorageBackup/x", "Storage")).toBe("Storage");
  });

  test("listFolderContents browses a memex storage lane through the mapping", () => {
    const items = [
      note({ id: "s1", title: "Loose", folderId: "Storage", diskFolderId: "storage" }),
      note({ id: "s2", title: "Chat log", folderId: "Storage", diskFolderId: "storage/chats" }),
      note({ id: "s3", title: "Deep", folderId: "Storage", diskFolderId: "storage/chats/2026" }),
    ];
    const pathOf = (n: NoteSummary) => rerootDiskPath(n.diskFolderId ?? n.folderId, "Storage");
    const l = listFolderContents(items, "Storage", [], pathOf);
    expect(l.items.map((n) => n.id)).toEqual(["s1"]);
    expect(l.folders.map((f) => f.path)).toEqual(["Storage/chats"]);
    expect(l.folders[0]?.itemCount).toBe(2);
    const inside = listFolderContents(items, "Storage/chats", [], pathOf);
    expect(inside.items.map((n) => n.id)).toEqual(["s2"]);
    expect(inside.folders.map((f) => f.path)).toEqual(["Storage/chats/2026"]);
  });
});

// Library system lanes (the maintainer, 2026-07-30): _inbox (→ the Captures front) and
// _templates (contract plumbing) are real directories but NOT browsable
// areas — hidden from the listing whether they arrive as item paths or seeds.
describe("hidden lanes", () => {
  const items = [
    note({ id: "a", title: "Alpha", folderId: "wiki", updatedAt: 30 }),
    note({ id: "s", title: "Staged", folderId: "wiki/_inbox", updatedAt: 50 }),
  ];
  const hidden = new Set(["wiki/_inbox", "wiki/_templates"]);

  test("hidden lanes never surface as folder tiles — from items or seeds", () => {
    const l = listFolderContents(items, "wiki", ["wiki/_templates", "wiki/Projects"], undefined, hidden);
    expect(l.folders.map((f) => f.path)).toEqual(["wiki/Projects"]);
  });

  test("without the hidden set the same lanes DO surface (other roots unaffected)", () => {
    const l = listFolderContents(items, "wiki", ["wiki/_templates", "wiki/Projects"]);
    expect(l.folders.map((f) => f.path).sort()).toEqual(["wiki/Projects", "wiki/_inbox", "wiki/_templates"]);
  });
});
