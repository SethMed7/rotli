// Main at machine scale (RAM review 2026-10-12): a Main mirrored from a 133k-file
// folder made the sidebar filter every folder and note once per folder and
// paint every row open (~14 GB in WebKit). These pin the two bounds.

import { describe, expect, test } from "bun:test";

import type { Folder } from "../types";
import {
  indexMainProjection,
  MAIN_DEFAULT_OPEN_LIMIT,
  mainFoldersOpenByDefault,
  mainTreeSize,
} from "./mainTree";

describe("indexMainProjection", () => {
  test("answers exactly what the per-folder filters answered, in projection order", () => {
    const folders: Folder[] = [
      { id: "main:A", name: "A", parentId: "main:" },
      { id: "main:A/B", name: "B", parentId: "main:A" },
      { id: "main:A", name: "A (again)", parentId: "main:" },
    ];
    const rows = [
      { id: "r1", folderId: "main:" },
      { id: "a1", folderId: "main:A" },
      { id: "b1", folderId: "main:A/B" },
      { id: "a2", folderId: "main:A" },
      { id: "r2", folderId: "main:" },
    ];
    const index = indexMainProjection({ folders, notes: rows });
    for (const parent of ["main:", "main:A", "main:A/B", "main:missing"]) {
      expect(index.notesIn(parent)).toEqual(rows.filter((n) => n.folderId === parent));
      expect(index.foldersIn(parent)).toEqual(folders.filter((f) => f.parentId === parent));
      expect(index.folderName(parent)).toBe(folders.find((f) => f.id === parent)?.name);
    }
  });
});

describe("mainFoldersOpenByDefault", () => {
  test("hand-sized Mains open; past the limit folders start folded", () => {
    expect(mainFoldersOpenByDefault(0)).toBe(true);
    expect(mainFoldersOpenByDefault(MAIN_DEFAULT_OPEN_LIMIT)).toBe(true);
    expect(mainFoldersOpenByDefault(MAIN_DEFAULT_OPEN_LIMIT + 1)).toBe(false);
    expect(mainFoldersOpenByDefault(145_553)).toBe(false);
  });

  test("the size counts every folder and note reference, nested", () => {
    expect(mainTreeSize([])).toBe(0);
    expect(
      mainTreeSize([
        { note: "a" },
        { folder: "F", children: [{ note: "b" }, { folder: "G", children: [] }] },
      ]),
    ).toBe(4);
  });
});
