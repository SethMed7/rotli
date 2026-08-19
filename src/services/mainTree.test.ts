import { describe, expect, test } from "bun:test";

import type { NoteSummary } from "../types";
import {
  type MainNode,
  addFolderToMain,
  artifactMainFolderName,
  uniqueRootFolderName,
  addNoteToMain,
  addNoteToMainAt,
  buildMainTree,
  mainParentOfNote,
  gcManifest,
  mainFolderIds,
  mainItemIdsInFolder,
  mainNoteIds,
  moveInTree,
  parseMainManifest,
  removeFromMain,
  fileNoteInNamedRootFolder,
  renameFolderInMain,
  renameNoteRef,
  mainRowSort,
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
  test("a Storage file can be arranged in Main when the identity index includes it", () => {
    const file = { ...note("storage/rotli/sample.docx", "Storage"), kind: "file" as const };
    const r = buildMainTree([{ note: file.id }], new Map([[file.id, file]]));
    expect(r.notes.map((item) => [item.id, item.folderId, item.kind])).toEqual([
      ["storage/rotli/sample.docx", "main:", "file"],
    ]);
  });
  test("a ref whose home is a sink (Archive/Trash) or the Vault is NOT rendered", () => {
    const index = new Map([
      ["trashed", note("trashed", "Trash")],
      ["archived", note("archived", "Archive")],
      ["vaulted", note("vaulted", "vault:lib")],
      ["live", note("live", "wiki/projects")],
    ]);
    const r = buildMainTree(
      [{ note: "trashed" }, { note: "archived" }, { note: "vaulted" }, { note: "live" }],
      index,
    );
    expect(r.notes.map((n) => n.id)).toEqual(["live"]);
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

  // The INPUT convention (the bug that silently emptied the maintainer's seeded Main):
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
  test("addNoteToMainAt: into a Main folder by its rendered id", () => {
    expect(addNoteToMainAt(base, "z", "main:Today")).toEqual([
      { note: "a" },
      { note: "b" },
      { folder: "Today", children: [{ note: "c" }, { note: "z" }] },
    ]);
  });
  test("addNoteToMainAt: MAIN_ROOT appends at the top level", () => {
    expect(addNoteToMainAt(base, "z", "main:")).toEqual([...base, { note: "z" }]);
  });
  test("addNoteToMainAt: unknown folder → lands at the root", () => {
    expect(addNoteToMainAt(base, "z", "main:Nope")).toEqual([...base, { note: "z" }]);
  });
  test("addNoteToMainAt: dedupes (already anywhere in Main)", () => {
    expect(addNoteToMainAt(base, "c", "main:")).toEqual(base);
  });

  test("mainParentOfNote: folder child → the folder id; top-level → MAIN_ROOT; absent → null", () => {
    expect(mainParentOfNote(base, "c")).toBe("main:Today");
    expect(mainParentOfNote(base, "a")).toBe("main:");
    expect(mainParentOfNote(base, "zzz")).toBeNull();
  });

  test("addFolderToMain appends an empty folder", () => {
    expect(addFolderToMain([], "Read later")).toEqual([{ folder: "Read later", children: [] }]);
  });
  test("uniqueRootFolderName predicts EXACTLY what addFolderToMain will mint (the scroll-to-new-folder id)", () => {
    const tree = addFolderToMain(addFolderToMain([], "inkling ai"), "inkling ai");
    // spaces survive — the rendered id is raw-name-derived, never slugged
    expect(uniqueRootFolderName([], "inkling ai")).toBe("inkling ai");
    expect(uniqueRootFolderName(tree, "inkling ai")).toBe("inkling ai 3");
    const committed = addFolderToMain(tree, "inkling ai");
    expect(committed.flatMap((n) => ("folder" in n ? [n.folder] : []))).toEqual([
      "inkling ai",
      "inkling ai 2",
      "inkling ai 3",
    ]);
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
    expect(removeFromMain(base, "c")).toEqual([
      { note: "a" },
      { note: "b" },
      { folder: "Today", children: [] },
    ]);
  });
});

describe("fileNoteInNamedRootFolder", () => {
  test("groups chat artifacts in Main without changing their durable ids", () => {
    const tree: MainNode[] = [{ note: "storage/rotli/other.docx" }];
    const once = fileNoteInNamedRootFolder(tree, "storage/rotli/report.docx", "Artifacts - Project chat");
    const twice = fileNoteInNamedRootFolder(once, "wiki/diagram.excalidraw", "Artifacts - Project chat");
    expect(twice).toEqual([
      { note: "storage/rotli/other.docx" },
      {
        folder: "Artifacts - Project chat",
        children: [{ note: "storage/rotli/report.docx" }, { note: "wiki/diagram.excalidraw" }],
      },
    ]);
  });

  test("normalizes chat titles so a visual folder cannot mint nested ids", () => {
    expect(artifactMainFolderName("  Project / Q3: plan  ")).toBe("Artifacts - Project Q3 plan");
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

describe("renameNoteRef — a board rename retargets its Main slot (#33)", () => {
  test("rewrites the ref in place at any depth, preserving order and nesting", () => {
    const tree: MainNode[] = [
      { note: "a" },
      { folder: "Today", children: [{ note: "Inbox/old.excalidraw" }, { note: "b" }] },
    ];
    expect(renameNoteRef(tree, "Inbox/old.excalidraw", "Inbox/new.excalidraw")).toEqual([
      { note: "a" },
      { folder: "Today", children: [{ note: "Inbox/new.excalidraw" }, { note: "b" }] },
    ]);
  });

  test("no-op when the old id isn't referenced", () => {
    const tree: MainNode[] = [{ note: "a" }];
    expect(renameNoteRef(tree, "gone", "new")).toEqual([{ note: "a" }]);
  });

  test("the renamed ref then survives a gc against the NEW id (the silent-GC repro)", () => {
    const tree: MainNode[] = [{ note: "Inbox/old.excalidraw" }];
    const renamed = renameNoteRef(tree, "Inbox/old.excalidraw", "Inbox/new.excalidraw");
    // after the rename only the new id is alive — the slot must survive
    expect(gcManifest(renamed, new Set(["Inbox/new.excalidraw"]))).toEqual([
      { note: "Inbox/new.excalidraw" },
    ]);
    // whereas the UN-renamed tree is exactly the bug: the slot vanishes
    expect(gcManifest(tree, new Set(["Inbox/new.excalidraw"]))).toEqual([]);
  });
});

describe("renameFolderInMain — Main folders are renameable (#16)", () => {
  const tree: MainNode[] = [
    { note: "a" },
    { folder: "Today", children: [{ note: "b" }, { folder: "Deep", children: [] }] },
    { folder: "Later", children: [] },
  ];

  test("renames a root folder, keeping children + position", () => {
    const out = renameFolderInMain(tree, "main:Today", "Now");
    expect(out).toEqual([
      { note: "a" },
      { folder: "Now", children: [{ note: "b" }, { folder: "Deep", children: [] }] },
      { folder: "Later", children: [] },
    ]);
  });

  test("renames a NESTED folder by its main:<path> id", () => {
    const out = renameFolderInMain(tree, "main:Today/Deep", "Deeper");
    expect(out[1]).toEqual({
      folder: "Today",
      children: [{ note: "b" }, { folder: "Deeper", children: [] }],
    });
  });

  test("uniquifies against SIBLINGS (never against itself)", () => {
    expect(renameFolderInMain(tree, "main:Later", "Today")[2]).toEqual({
      folder: "Today 2",
      children: [],
    });
    // renaming to its own current name is a clean no-op, not "Today 2"
    expect(renameFolderInMain(tree, "main:Today", "Today")[1]).toMatchObject({ folder: "Today" });
  });

  test("empty/whitespace name and a missing id are no-ops", () => {
    expect(renameFolderInMain(tree, "main:Today", "   ")).toEqual(tree);
    expect(renameFolderInMain(tree, "main:Nope", "X")).toEqual(tree);
  });
});

describe("mainFolderIds — the collapse-all / GC id grammar (#83/#78)", () => {
  test('collects every folder id in buildMainTree\'s exact "main:<path>" shape', () => {
    const tree: MainNode[] = [
      { note: "a" },
      {
        folder: "Today",
        children: [{ note: "b" }, { folder: "Deep", children: [{ note: "c" }] }],
      },
      { folder: "Later", children: [] },
    ];
    expect(mainFolderIds(tree)).toEqual(["main:Today", "main:Today/Deep", "main:Later"]);
  });

  test("empty tree → no ids", () => {
    expect(mainFolderIds([])).toEqual([]);
  });
});

describe("mainItemIdsInFolder — virtual-folder lifecycle scope", () => {
  const tree: MainNode[] = [
    { note: "outside" },
    {
      folder: "Work",
      children: [{ note: "a" }, { folder: "Deep", children: [{ note: "b" }, { note: "a" }] }],
    },
  ];

  test("collects nested durable ids once without touching siblings", () => {
    expect(mainItemIdsInFolder(tree, "main:Work")).toEqual(["a", "b"]);
    expect(mainItemIdsInFolder(tree, "main:Work/Deep")).toEqual(["b", "a"]);
  });

  test("missing and empty folders have no durable contents", () => {
    expect(mainItemIdsInFolder(tree, "main:Missing")).toEqual([]);
    expect(mainItemIdsInFolder([{ folder: "Empty", children: [] }], "main:Empty")).toEqual([]);
  });
});

// P0 sweep 2026-07-28: the roving j/k order MUST mirror the rendered order —
// renderMainTree floats pinned notes, the keyboard walk didn't, so the cursor
// visibly teleported whenever a Main note was pinned. One comparator, two users.
describe("mainRowSort", () => {
  test("pinned notes float first, then the hand-arranged order", () => {
    const rows = [
      { pinned: false, mainOrder: 0 },
      { pinned: true, mainOrder: 2 },
      { pinned: false, mainOrder: 1 },
    ];
    expect([...rows].sort(mainRowSort).map((r) => r.mainOrder)).toEqual([2, 0, 1]);
  });
});
