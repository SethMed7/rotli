import { describe, expect, test } from "bun:test";
import {
  EMPTY_VIEWS,
  assignItemToView,
  assignedView,
  createNamedView,
  deleteNamedView,
  parseViewsManifest,
  renameNamedView,
  setNamedViewTree,
  transferTreeItemToView,
  viewNameError,
  viewTree,
} from "./viewTree";

describe("named view schema", () => {
  test("names are unique without fancy ids and Main stays reserved", () => {
    const one = createNamedView(EMPTY_VIEWS, " OpenSource ");
    expect(one.views.map((view) => view.name)).toEqual(["OpenSource"]);
    expect(createNamedView(one, "opensource")).toBe(one);
    expect(viewNameError("Main", one.views)).toContain("reserved");
    expect(viewNameError("team/work", one.views)).toContain("letters");
  });

  test("future manifests fail read-only instead of being stamped down", () => {
    const parsed = parseViewsManifest('{"version":2,"views":[{"name":"Future","tree":[]}]}');
    expect(parsed.writable).toBe(false);
    expect(parsed.manifest).toEqual(EMPTY_VIEWS);
    expect(parsed.error).toContain("newer Rotli format");
  });

  test("malformed nodes are dropped while valid folders survive", () => {
    const parsed = parseViewsManifest(
      JSON.stringify({
        version: 1,
        views: [
          { name: "Work", tree: [{ nope: true }, { folder: "Plans", children: [{ note: "a" }] }] },
          { name: "work", tree: [] },
        ],
      }),
    );
    expect(parsed.manifest.views).toEqual([
      { name: "Work", tree: [{ folder: "Plans", children: [{ note: "a" }] }] },
    ]);
  });
});

describe("named view membership", () => {
  test("assignment is singular and Main is not represented as another view", () => {
    let manifest = createNamedView(createNamedView(EMPTY_VIEWS, "OpenSource"), "Myela");
    manifest = assignItemToView(manifest, "note-a", "OpenSource");
    expect(assignedView(manifest, "note-a")).toBe("OpenSource");
    manifest = assignItemToView(manifest, "note-a", "Myela");
    expect(viewTree(manifest, "OpenSource")).toEqual([]);
    expect(viewTree(manifest, "Myela")).toEqual([{ note: "note-a" }]);
    manifest = assignItemToView(manifest, "note-a", null);
    expect(assignedView(manifest, "note-a")).toBeNull();
  });

  test("active-view folders keep their tree and GC orphan references", () => {
    let manifest = createNamedView(EMPTY_VIEWS, "OpenSource");
    manifest = setNamedViewTree(
      manifest,
      "OpenSource",
      [{ folder: "Rotli", children: [{ note: "live" }, { note: "gone" }] }],
      new Set(["live"]),
    );
    expect(viewTree(manifest, "OpenSource")).toEqual([{ folder: "Rotli", children: [{ note: "live" }] }]);
  });

  test("rename and delete preserve trees until deletion", () => {
    let manifest = createNamedView(EMPTY_VIEWS, "OpenSource");
    manifest = setNamedViewTree(manifest, "OpenSource", [{ note: "a" }]);
    manifest = renameNamedView(manifest, "OpenSource", "Community");
    expect(viewTree(manifest, "Community")).toEqual([{ note: "a" }]);
    expect(deleteNamedView(manifest, "Community")).toEqual(EMPTY_VIEWS);
  });

  test("moving a Main folder copies its structure while named-view moves remove the source", () => {
    const main = [{ folder: "Rotli", children: [{ note: "a" }, { note: "b" }] }];
    let manifest = createNamedView(createNamedView(EMPTY_VIEWS, "OpenSource"), "Myela");
    manifest = transferTreeItemToView(main, manifest, null, "main:Rotli", "OpenSource");
    expect(viewTree(manifest, "OpenSource")).toEqual(main);
    manifest = transferTreeItemToView(main, manifest, "OpenSource", "main:Rotli", "Myela");
    expect(viewTree(manifest, "OpenSource")).toEqual([]);
    expect(viewTree(manifest, "Myela")).toEqual(main);
    expect(main).toEqual([{ folder: "Rotli", children: [{ note: "a" }, { note: "b" }] }]);
  });
});
