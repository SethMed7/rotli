import { expect, test } from "bun:test";

import { composeNewChat } from "../memex/contract";
import { IMPORTED_FOLDER_ROLES } from "./destinations";
import { MemoryVaultDir } from "./vaultDir";
import { FolderChatStore, webMemexBridge } from "./webChats";

test.each([
  { folder: "chats (Rotli)", inPlace: false },
  { folder: "Conversations (Rotli)", inPlace: true },
])("an imported chat listing points to its actual $folder file", async ({ folder, inPlace }) => {
  const dir = new MemoryVaultDir();
  await dir.writeText(
    "memex.json",
    JSON.stringify({
      id: "mx_fixture",
      layout: "imported",
      inPlace,
      folders: { ...IMPORTED_FOLDER_ROLES, chats: folder },
    }),
  );
  const personal = "The person's existing folder stays separate.";
  await dir.writeText("chats/personal.md", personal);
  const chat = composeNewChat(
    { title: "Weekly plan", source: "rotli", slug: "weekly-plan" },
    [{ speaker: "you", text: "Plan the week" }],
    "2026-10-22",
  );
  const store = new FolderChatStore(dir);
  const bridge = webMemexBridge(store);
  const writtenPath = await bridge("memex_write_chat", {
    slug: "weekly-plan",
    contents: chat.contents,
    expectedRevision: null,
  });
  if (typeof writtenPath !== "string") throw new Error("chat write did not return a path");
  const listed = (await bridge("memex_list_chats", {})) as Awaited<ReturnType<FolderChatStore["list"]>>;
  expect(listed).toHaveLength(1);
  expect(writtenPath).toBe(`${folder}/weekly-plan.md`);
  expect(listed[0]!.path).toBe(writtenPath);
  expect(await dir.readText(listed[0]!.path)).toBe(chat.contents);
  expect(await dir.readText("chats/personal.md")).toBe(personal);
});
