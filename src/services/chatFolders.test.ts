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
  setChatFolderOrder,
  serializeChatFolders,
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

// Manual in-folder order (Seth, 2026-07-30: "within a folder I should be able
// to reorganize things") — an additive v1 field; absent order keeps list order.
describe("chat folder manual order", () => {
  const chats = [{ slug: "a" }, { slug: "b" }, { slug: "c" }, { slug: "d" }];

  test("no manual order keeps the list's own order", () => {
    let { manifest, id } = createChatFolder(EMPTY_CHAT_FOLDERS, "Work");
    for (const slug of ["a", "b", "c"]) manifest = assignChatToFolder(manifest, slug, id);
    expect(groupChats(chats, manifest).folders[0]?.chats.map((c) => c.slug)).toEqual(["a", "b", "c"]);
  });

  test("setChatFolderOrder reorders; unlisted (new) chats keep list order after", () => {
    let { manifest, id } = createChatFolder(EMPTY_CHAT_FOLDERS, "Work");
    for (const slug of ["a", "b", "c", "d"]) manifest = assignChatToFolder(manifest, slug, id);
    manifest = setChatFolderOrder(manifest, id, ["c", "a"]);
    expect(groupChats(chats, manifest).folders[0]?.chats.map((c) => c.slug)).toEqual(["c", "a", "b", "d"]);
  });

  test("order survives a serialize/parse round-trip; unknown folders and junk are dropped", () => {
    let { manifest, id } = createChatFolder(EMPTY_CHAT_FOLDERS, "Work");
    manifest = assignChatToFolder(manifest, "a", id);
    manifest = setChatFolderOrder(manifest, id, ["a"]);
    const reparsed = parseChatFolders(
      serializeChatFolders(manifest).replace('"order": {', '"order": {"cf-ghost": ["x"], "bad": 7, '),
    );
    expect(reparsed.order).toEqual({ [id]: ["a"] });
    // setting order on an unknown folder is a no-op
    expect(setChatFolderOrder(manifest, "cf-nope", ["a"])).toEqual(manifest);
  });

  test("a legacy manifest without order parses to an empty order map", () => {
    const legacy = parseChatFolders('{"version":1,"folders":[{"id":"cf-1","name":"W"}],"assignments":{}}');
    expect(legacy.order).toEqual({});
  });

  test("a renamed chat keeps its manual position", () => {
    let { manifest, id } = createChatFolder(EMPTY_CHAT_FOLDERS, "Work");
    manifest = assignChatToFolder(manifest, "old", id);
    manifest = assignChatToFolder(manifest, "b", id);
    manifest = setChatFolderOrder(manifest, id, ["b", "old"]);
    const migrated = migrateChatFolderSlug(manifest, "old", "new");
    expect(migrated.order[id]).toEqual(["b", "new"]);
  });

  test("deleting a folder drops its order entry", () => {
    let { manifest, id } = createChatFolder(EMPTY_CHAT_FOLDERS, "Work");
    manifest = setChatFolderOrder(manifest, id, ["a"]);
    expect(deleteChatFolder(manifest, id).order).toEqual({});
  });
});
