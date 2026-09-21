import { describe, expect, test } from "bun:test";

import {
  EMPTY_VIEWS,
  assignChatToView,
  assignItemToView,
  assignedView,
  chatAssignedView,
  createNamedView,
  deleteNamedView,
  migrateChatViewSlug,
  parseViewsManifest,
  projectionMenuAction,
  renameNamedView,
  renameViewItemRef,
  setNamedViewTree,
  transferTreeItemToView,
  viewFolderNameError,
  viewChats,
  viewNameError,
  viewPickerItems,
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
  test("menu copy distinguishes view removal from Main membership", () => {
    expect(projectionMenuAction("OpenSource", "OpenSource", true)).toEqual({
      kind: "remove-view",
      label: "Remove from OpenSource",
    });
    expect(projectionMenuAction(null, "OpenSource", true)).toEqual({
      kind: "remove-main",
      label: "Remove from Main",
    });
    expect(projectionMenuAction(null, null, false)).toEqual({
      kind: "add-main",
      label: "Add to Main",
    });
  });

  test("assignment is singular and Main is not represented as another view", () => {
    let manifest = createNamedView(createNamedView(EMPTY_VIEWS, "OpenSource"), "Northstar");
    manifest = assignItemToView(manifest, "note-a", "OpenSource");
    expect(assignedView(manifest, "note-a")).toBe("OpenSource");
    manifest = assignItemToView(manifest, "note-a", "Northstar");
    expect(viewTree(manifest, "OpenSource")).toEqual([]);
    expect(viewTree(manifest, "Northstar")).toEqual([{ note: "note-a" }]);
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
    let manifest = createNamedView(createNamedView(EMPTY_VIEWS, "OpenSource"), "Northstar");
    manifest = transferTreeItemToView(main, manifest, null, "main:Rotli", "OpenSource");
    expect(viewTree(manifest, "OpenSource")).toEqual(main);
    manifest = transferTreeItemToView(main, manifest, "OpenSource", "main:Rotli", "Northstar");
    expect(viewTree(manifest, "OpenSource")).toEqual([]);
    expect(viewTree(manifest, "Northstar")).toEqual(main);
    expect(main).toEqual([{ folder: "Rotli", children: [{ note: "a" }, { note: "b" }] }]);
  });
});

// Chats in views (the maintainer, 2026-08-03: "bring the views into the chat area so
// people can organize chats by work vs personal"). Chats key by slug, live in
// at most one view, and the field round-trips parse/serialize.
describe("chats in named views", () => {
  test("assign moves a chat between views; null returns it to Main-only", () => {
    let manifest = createNamedView(createNamedView(EMPTY_VIEWS, "Work"), "Personal");
    manifest = assignChatToView(manifest, "gateway-uat", "Work");
    expect(chatAssignedView(manifest, "gateway-uat")).toBe("Work");
    expect(viewChats(manifest, "Work")).toEqual(["gateway-uat"]);

    manifest = assignChatToView(manifest, "gateway-uat", "Personal");
    expect(viewChats(manifest, "Work")).toEqual([]);
    expect(viewChats(manifest, "Personal")).toEqual(["gateway-uat"]);

    manifest = assignChatToView(manifest, "gateway-uat", null);
    expect(chatAssignedView(manifest, "gateway-uat")).toBeNull();
    // an emptied list drops the field — the manifest stays clean on disk
    expect(manifest.views.every((view) => view.chats === undefined)).toBe(true);
  });

  test("an unknown target view or a same-state assign is a no-op reference-wise", () => {
    const manifest = createNamedView(EMPTY_VIEWS, "Work");
    expect(assignChatToView(manifest, "x", "Nope")).toBe(manifest);
    expect(assignChatToView(manifest, "x", null)).toBe(manifest);
  });

  test("chats survive parse/serialize; junk entries and duplicates drop", () => {
    let manifest = createNamedView(EMPTY_VIEWS, "Work");
    manifest = assignChatToView(manifest, "daily", "Work");
    const reparsed = parseViewsManifest(JSON.stringify(manifest));
    expect(viewChats(reparsed.manifest, "Work")).toEqual(["daily"]);
    const junk = parseViewsManifest(
      '{"version":1,"views":[{"name":"Work","tree":[],"chats":["a",7,"","a"]}]}',
    );
    expect(viewChats(junk.manifest, "Work")).toEqual(["a"]);
  });

  test("a renamed chat keeps its view; deleting the view frees its chats", () => {
    let manifest = createNamedView(EMPTY_VIEWS, "Work");
    manifest = assignChatToView(manifest, "old-slug", "Work");
    manifest = migrateChatViewSlug(manifest, "old-slug", "new-slug");
    expect(viewChats(manifest, "Work")).toEqual(["new-slug"]);
    expect(migrateChatViewSlug(manifest, "not-assigned", "x")).toBe(manifest);
    expect(chatAssignedView(deleteNamedView(manifest, "Work"), "new-slug")).toBeNull();
  });
});

describe("view picker menu", () => {
  const on = { show: () => {}, create: () => {}, rename: () => {}, remove: () => {} };
  const two = createNamedView(createNamedView(EMPTY_VIEWS, "Alpha"), "Beta");

  test("every view is deletable through the drill without being shown first", () => {
    const items = viewPickerItems(two, null, true, on);
    const drill = items.find((item) => item.kind === "drill");
    expect(drill).toMatchObject({
      label: expect.stringMatching(/^Delete a view/),
      danger: true,
      disabled: false,
    });
    if (drill?.kind !== "drill") throw new Error("expected a drill");
    expect(drill.items.map((item) => (item.kind === "action" ? item.label : ""))).toEqual(["Alpha", "Beta"]);
    expect(items.some((item) => item.kind === "action" && item.label.startsWith("Rename"))).toBe(false);
  });

  test("the shown view adds rename and its own delete; no views or a read-only vault disable deletion", () => {
    const shown = viewPickerItems(two, "Beta", true, on).map((item) =>
      item.kind === "sep" ? "—" : item.label,
    );
    expect(shown.slice(-3).map((label) => label.replace(/…$/, ""))).toEqual([
      "Delete a view",
      "Rename view",
      "Delete view",
    ]);
    expect(viewPickerItems(EMPTY_VIEWS, null, true, on).find((item) => item.kind === "drill")).toMatchObject({
      disabled: true,
    });
    expect(viewPickerItems(two, null, false, on).find((item) => item.kind === "drill")).toMatchObject({
      disabled: true,
    });
  });
});

describe("renamed path items", () => {
  test("every view reference follows a renamed document in place", () => {
    let manifest = createNamedView(createNamedView(EMPTY_VIEWS, "Work"), "Home");
    manifest = assignItemToView(manifest, "storage/rotli/untitled-1.docx", "Work", "main:Plans");
    const renamed = renameViewItemRef(manifest, "storage/rotli/untitled-1.docx", "storage/rotli/Plan.docx");
    expect(assignedView(renamed, "storage/rotli/Plan.docx")).toBe("Work");
    expect(assignedView(renamed, "storage/rotli/untitled-1.docx")).toBeNull();
    expect(viewTree(renamed, "Work")).toEqual(
      viewTree(manifest, "Work").map((node) =>
        JSON.parse(JSON.stringify(node).replace("untitled-1.docx", "Plan.docx")),
      ),
    );
  });
  test("a folder name refuses the path and root separators, with plain words", () => {
    expect(viewFolderNameError("Rotli Bugs/Enhancements")).toBe(
      "Folder names cannot contain slashes or colons.",
    );
    expect(viewFolderNameError("Q1: plans")).toBe("Folder names cannot contain slashes or colons.");
    expect(viewFolderNameError("   ")).toBe("Enter a folder name.");
    expect(viewFolderNameError("Plans 2026 – drafts")).toBeNull();
  });

  test("a badly named Main folder still moves into a view, made portable", () => {
    const main = [
      { note: "loose" },
      {
        folder: "Rotli Bugs/Enhancements",
        children: [
          { folder: "a:b", children: [{ note: "one" }] },
          { folder: "a b", children: [{ note: "two" }] },
        ],
      },
    ];
    const manifest = createNamedView(EMPTY_VIEWS, "Work");
    const moved = transferTreeItemToView(main, manifest, null, "main:Rotli Bugs/Enhancements", "Work");
    expect(moved.views[0]?.tree).toEqual([
      {
        folder: "Rotli Bugs Enhancements",
        children: [
          { folder: "a b", children: [{ note: "one" }] },
          { folder: "a b 2", children: [{ note: "two" }] },
        ],
      },
    ]);
  });
});
