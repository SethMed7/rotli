// System-browser locks (Finder rework 2026-07-27, Seth's screenshots): the
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
  test("mirrors Finder's Kind column for the three item families", () => {
    expect(kindLabel(note({}))).toBe("Note");
    expect(kindLabel(note({ kind: "board" }))).toBe("Board");
    expect(kindLabel(note({ kind: "file" }))).toBe("File");
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
