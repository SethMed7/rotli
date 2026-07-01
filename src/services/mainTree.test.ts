import { describe, expect, test } from "bun:test";
import type { NoteSummary } from "../types";
import {
  type MainNode,
  addFolderToMain,
  addNoteToMain,
  buildMainTree,
  gcManifest,
  mainNoteIds,
  moveInTree,
  parseMainManifest,
  removeFromMain,
} from "./mainTree";

const note = (id: string): NoteSummary =>
  ({
    id,
    title: id,
    snippet: "",
    folderId: "wiki/projects",
    createdAt: 0,
    updatedAt: 0,
    pinned: false,
    kind: "note",
  }) as NoteSummary;

describe("parseMainManifest", () => {
  test("corrupt JSON → empty", () => expect(parseMainManifest("{{").tree).toEqual([]));
  test("non-object → empty", () => expect(parseMainManifest("42").tree).toEqual([]));
  test("sanitizes junk / blank-folder nodes", () => {
    const m = parseMainManifest(
      JSON.stringify({
        tree: [{ note: "a" }, { junk: 1 }, { folder: "  " }, { folder: "Today", children: [{ note: "b" }] }],
      }),
    );
    expect(m.tree).toEqual([{ note: "a" }, { folder: "Today", children: [{ note: "b" }] }]);
  });
});

describe("buildMainTree", () => {
  const notes = new Map([
    ["a", note("a")],
    ["b", note("b")],
  ]);
  const tree: MainNode[] = [{ note: "a" }, { folder: "Today", children: [{ note: "b" }, { note: "gone" }] }];
  const { folders, notes: out } = buildMainTree(tree, notes);

  test("top-level Main folder gets id main:<name>, parent main:", () => {
    expect(folders).toEqual([{ id: "main:Today", name: "Today", parentId: "main:" }]);
  });
  test("notes re-homed to their Main folder, in manifest order, orphan dropped", () => {
    expect(out.map((n) => [n.id, n.folderId, n.mainOrder])).toEqual([
      ["a", "main:", 0],
      ["b", "main:Today", 1],
    ]);
  });
  test("nested folder ids chain by path", () => {
    const r = buildMainTree([{ folder: "A", children: [{ folder: "B", children: [] }] }], notes);
    expect(r.folders.map((f) => f.id)).toEqual(["main:A", "main:A/B"]);
    expect(r.folders[1]?.parentId).toBe("main:A");
  });
});

describe("gcManifest", () => {
  test("drops dead note-refs, keeps empty folders", () => {
    const tree: MainNode[] = [
      { note: "a" },
      { note: "dead" },
      { folder: "Empty", children: [{ note: "dead2" }] },
    ];
    expect(gcManifest(tree, new Set(["a"]))).toEqual([{ note: "a" }, { folder: "Empty", children: [] }]);
  });
});

describe("tree mutations", () => {
  const base: MainNode[] = [{ note: "a" }, { note: "b" }, { folder: "Today", children: [{ note: "c" }] }];

  test("moveInTree: reorder before a sibling", () => {
    expect(moveInTree(base, "b", "a", "before")).toEqual([
      { note: "b" },
      { note: "a" },
      { folder: "Today", children: [{ note: "c" }] },
    ]);
  });
  test("moveInTree: into a folder (prepends)", () => {
    expect(moveInTree(base, "a", "main:Today", "into")).toEqual([
      { note: "b" },
      { folder: "Today", children: [{ note: "a" }, { note: "c" }] },
    ]);
  });
  test("moveInTree: out of a folder to root", () => {
    expect(moveInTree(base, "c", "main:", "into")).toEqual([
      { note: "a" },
      { note: "b" },
      { folder: "Today", children: [] },
      { note: "c" },
    ]);
  });
  test("moveInTree: unknown target → unchanged", () => {
    expect(moveInTree(base, "a", "nope", "after")).toEqual(base);
  });

  test("addNoteToMain dedupes (already present anywhere)", () => {
    expect(addNoteToMain(base, "c")).toEqual(base); // c is inside Today
    expect(addNoteToMain(base, "z")).toEqual([...base, { note: "z" }]);
  });
  test("addFolderToMain appends an empty folder", () => {
    expect(addFolderToMain([], "Read later")).toEqual([{ folder: "Read later", children: [] }]);
  });
  test("removeFromMain drops a nested note", () => {
    expect(removeFromMain(base, "c")).toEqual([{ note: "a" }, { note: "b" }, { folder: "Today", children: [] }]);
  });
});

describe("mainNoteIds", () => {
  test("collects note ids at every depth (the Captures curated-note filter)", () => {
    const tree: MainNode[] = [
      { note: "a" },
      { folder: "Today", children: [{ note: "b" }, { folder: "Deep", children: [{ note: "c" }] }] },
    ];
    expect(mainNoteIds(tree)).toEqual(new Set(["a", "b", "c"]));
  });
  test("empty tree → empty set", () => {
    expect(mainNoteIds([])).toEqual(new Set());
  });
});
