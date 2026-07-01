import { describe, expect, test } from "bun:test";
import type { NoteSummary } from "../types";
import { type MainNode, buildMainTree, gcManifest, parseMainManifest } from "./mainTree";

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
