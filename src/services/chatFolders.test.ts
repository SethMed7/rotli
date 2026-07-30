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
