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

const note = (id: string, folderId = "wiki/projects"): NoteSummary =>
  ({
    id,
    title: id,
    snippet: "",
    folderId,
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
  test("a STAGED note (hidden Board root) projects like any other — given the full index", () => {
    const index = new Map([["staged", note("staged", "Board")]]);
    const r = buildMainTree([{ note: "staged" }], index);
    expect(r.notes.map((n) => [n.id, n.folderId])).toEqual([["staged", "main:"]]);
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

  // The INPUT convention (the bug that silently emptied Seth's seeded Main):
  // liveIds MUST be the FULL note-index keys — the default listing PLUS the
  // hidden roots (staged "Board", "Archive", "Trash"). A note that still exists
  // ANYWHERE is not an orphan; only a truly-deleted id drops.
  test("liveIds = the full index keys: staged/archived/trashed refs survive, deleted ids drop", () => {
    const index = new Map(
      [
        note("curated", "wiki/projects"),
        note("staged", "Board"), // wiki/_inbox projects to the hidden Board root
        note("archived", "Archive"),
        note("trashed", "Trash"),
      ].map((n) => [n.id, n] as const),
    );
    const tree: MainNode[] = [
      { note: "curated" },
      { note: "staged" },
      { folder: "Keep", children: [{ note: "archived" }, { note: "trashed" }, { note: "deleted" }] },
    ];
    expect(gcManifest(tree, new Set(index.keys()))).toEqual([
      { note: "curated" },
      { note: "staged" },
      { folder: "Keep", children: [{ note: "archived" }, { note: "trashed" }] },
    ]);
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
  test("addFolderToMain uniquifies against root siblings (ids are name-derived)", () => {
    const one = addFolderToMain([], "New folder");
    const two = addFolderToMain(one, "New folder");
    const three = addFolderToMain(two, "New folder");
    expect(three.flatMap((n) => ("folder" in n ? [n.folder] : []))).toEqual([
      "New folder",
      "New folder 2",
      "New folder 3",
    ]);
  });
  test("addFolderToMain ignores note ids and nested folder names when uniquifying", () => {
    const tree: MainNode[] = [
      { note: "New folder" }, // a note id never blocks a folder name
      { folder: "Today", children: [{ folder: "New folder", children: [] }] },
    ];
    const out = addFolderToMain(tree, "New folder");
    expect(out[out.length - 1]).toEqual({ folder: "New folder", children: [] });
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
