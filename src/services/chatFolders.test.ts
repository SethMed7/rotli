import { describe, expect, test } from "bun:test";

import {
  EMPTY_CHAT_FOLDERS,
  assignChatToFolder,
  createChatFolder,
  deleteChatFolder,
  groupChats,
  migrateChatFolderSlug,
  parseChatFolders,
  renameChatFolder,
  serializeChatFolders,
  setChatFolderPinned,
} from "./chatFolders";

describe("chat folders (virtual grouping over flat chats/)", () => {
  test("round-trips through serialize/parse and survives garbage", () => {
    const { manifest, id } = createChatFolder(EMPTY_CHAT_FOLDERS, "Work");
    const assigned = assignChatToFolder(manifest, "fluidpay-analysis", id);
    expect(parseChatFolders(serializeChatFolders(assigned))).toEqual(assigned);
    // malformed sidecars read as empty — never break the chat list
    expect(parseChatFolders("")).toEqual(EMPTY_CHAT_FOLDERS);
    expect(parseChatFolders("{not json")).toEqual(EMPTY_CHAT_FOLDERS);
    expect(parseChatFolders('{"version":9,"folders":[]}')).toEqual(EMPTY_CHAT_FOLDERS);
    // assignments to unknown folders are dropped on parse
    const dangling = parseChatFolders('{"version":1,"folders":[],"assignments":{"chat-a":"cf-gone"}}');
    expect(dangling.assignments).toEqual({});
  });

  test("grouping keeps manifest folder order and original chat order", () => {
    let { manifest, id: work } = createChatFolder(EMPTY_CHAT_FOLDERS, "Work");
    const personal = createChatFolder(manifest, "Personal");
    manifest = personal.manifest;
    manifest = assignChatToFolder(manifest, "b", work);
    manifest = assignChatToFolder(manifest, "d", personal.id);
    const chats = [{ slug: "a" }, { slug: "b" }, { slug: "c" }, { slug: "d" }];
    const grouped = groupChats(chats, manifest);
    expect(grouped.folders.map((f) => f.folder.name)).toEqual(["Work", "Personal"]);
    expect(grouped.folders[0]?.chats.map((c) => c.slug)).toEqual(["b"]);
    expect(grouped.folders[1]?.chats.map((c) => c.slug)).toEqual(["d"]);
    expect(grouped.loose.map((c) => c.slug)).toEqual(["a", "c"]);
  });

  test("an unpinned folder with the newest chat floats above older folders", () => {
    let { manifest, id: work } = createChatFolder(EMPTY_CHAT_FOLDERS, "Work");
    const personal = createChatFolder(manifest, "Personal");
    manifest = personal.manifest;
    manifest = assignChatToFolder(manifest, "old", work);
    manifest = assignChatToFolder(manifest, "new", personal.id);
    const chats = [
      { slug: "new", modifiedMs: 900 },
      { slug: "old", modifiedMs: 100 },
    ];
    expect(groupChats(chats, manifest).folders.map((f) => f.folder.name)).toEqual(["Personal", "Work"]);
  });

  test("a folder with activity floats above an empty folder", () => {
    let { manifest, id: empty } = createChatFolder(EMPTY_CHAT_FOLDERS, "Empty");
    const active = createChatFolder(manifest, "Active");
    manifest = assignChatToFolder(active.manifest, "recent", active.id);
    expect(
      groupChats([{ slug: "recent", modifiedMs: 900 }], manifest).folders.map((f) => f.folder.name),
    ).toEqual(["Active", "Empty"]);
    expect(empty).not.toBe(active.id);
  });

  test("deleting a folder frees its chats; renaming keeps assignments", () => {
    let { manifest, id } = createChatFolder(EMPTY_CHAT_FOLDERS, "Work");
    manifest = assignChatToFolder(manifest, "b", id);
    const renamed = renameChatFolder(manifest, id, "Myela");
    expect(renamed.folders[0]?.name).toBe("Myela");
    expect(renamed.assignments.b).toBe(id);
    const deleted = deleteChatFolder(renamed, id);
    expect(deleted.folders).toEqual([]);
    expect(deleted.assignments).toEqual({});
    expect(groupChats([{ slug: "b" }], deleted).loose.map((c) => c.slug)).toEqual(["b"]);
  });

  test("a renamed chat's assignment follows the new slug", () => {
    let { manifest, id } = createChatFolder(EMPTY_CHAT_FOLDERS, "Work");
    manifest = assignChatToFolder(manifest, "old-name", id);
    const migrated = migrateChatFolderSlug(manifest, "old-name", "new-name");
    expect(migrated.assignments).toEqual({ "new-name": id });
    // unassigned renames are a no-op
    expect(migrateChatFolderSlug(manifest, "not-assigned", "x")).toEqual(manifest);
  });

  test("assigning to an unknown folder or clearing works safely", () => {
    const { manifest, id } = createChatFolder(EMPTY_CHAT_FOLDERS, "Work");
    expect(assignChatToFolder(manifest, "a", "cf-nope").assignments).toEqual({});
    const assigned = assignChatToFolder(manifest, "a", id);
    expect(assignChatToFolder(assigned, "a", null).assignments).toEqual({});
  });
});

// In-folder order = the LIST's order (Seth, 2026-08-03: "the moment I get a
// response it should move to the top of the folder"). The legacy manual-order
// field still parses (older builds lose nothing) but no longer changes
// rendering.
describe("chat folder ordering — response recency rules", () => {
  const chats = [{ slug: "a" }, { slug: "b" }, { slug: "c" }, { slug: "d" }];

  test("folder chats keep the list's own order (pinned-then-recency upstream)", () => {
    let { manifest, id } = createChatFolder(EMPTY_CHAT_FOLDERS, "Work");
    for (const slug of ["a", "b", "c"]) manifest = assignChatToFolder(manifest, slug, id);
    expect(groupChats(chats, manifest).folders[0]?.chats.map((c) => c.slug)).toEqual(["a", "b", "c"]);
  });

  test("a legacy manual order parses but no longer reorders the render", () => {
    let { manifest, id } = createChatFolder(EMPTY_CHAT_FOLDERS, "Work");
    for (const slug of ["a", "b", "c", "d"]) manifest = assignChatToFolder(manifest, slug, id);
    const withOrder = { ...manifest, order: { [id]: ["c", "a"] } };
    const reparsed = parseChatFolders(serializeChatFolders(withOrder));
    expect(reparsed.order).toEqual({ [id]: ["c", "a"] }); // survives for old builds
    expect(groupChats(chats, reparsed).folders[0]?.chats.map((c) => c.slug)).toEqual(["a", "b", "c", "d"]);
  });

  test("a legacy manifest without order parses to an empty order map", () => {
    const legacy = parseChatFolders('{"version":1,"folders":[{"id":"cf-1","name":"W"}],"assignments":{}}');
    expect(legacy.order).toEqual({});
  });
});

// Pinned folders (Seth, 2026-08-03): a pinned folder floats above the rest,
// manifest order preserved within each band.
describe("pinned chat folders", () => {
  test("pin floats a folder to the top; unpin returns it to manifest order", () => {
    let manifest = createChatFolder(EMPTY_CHAT_FOLDERS, "Work").manifest;
    const personal = createChatFolder(manifest, "Personal");
    manifest = personal.manifest;
    const pinned = setChatFolderPinned(manifest, personal.id, true);
    expect(groupChats([], pinned).folders.map((f) => f.folder.name)).toEqual(["Personal", "Work"]);
    const unpinned = setChatFolderPinned(pinned, personal.id, false);
    expect(groupChats([], unpinned).folders.map((f) => f.folder.name)).toEqual(["Work", "Personal"]);
    // unpin strips the field entirely — the manifest stays clean on disk
    expect(unpinned.folders.find((f) => f.id === personal.id)).toEqual({
      id: personal.id,
      name: "Personal",
    });
    expect(setChatFolderPinned(manifest, "cf-nope", true)).toEqual(manifest);
  });

  test("pinned survives serialize/parse; junk pinned values read unpinned", () => {
    const { manifest, id } = createChatFolder(EMPTY_CHAT_FOLDERS, "Work");
    const pinned = setChatFolderPinned(manifest, id, true);
    expect(parseChatFolders(serializeChatFolders(pinned)).folders[0]?.pinned).toBe(true);
    const junk = parseChatFolders(
      `{"version":1,"folders":[{"id":"cf-1","name":"W","pinned":"yes"}],"assignments":{}}`,
    );
    expect(junk.folders[0]?.pinned).toBeUndefined();
  });
});
