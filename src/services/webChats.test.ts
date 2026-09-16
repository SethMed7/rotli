import { describe, expect, test } from "bun:test";

import { MemoryVaultStore } from "../lib/browserVault";
import { appendMessages, composeNewChat } from "../memex/contract";
import { createWebChatStore, webMemexBridge } from "./webChats";

const DATE = "2026-09-16";

describe("web chat store", () => {
  test("a chat is written once, appended with its revision, listed, and read back", async () => {
    const store = createWebChatStore(new MemoryVaultStore());
    const bridge = webMemexBridge(store);
    const born = composeNewChat(
      { title: "Plan", source: "rotli", slug: "plan" },
      [{ speaker: "you", text: "hi" }],
      DATE,
    );
    await bridge("memex_write_chat", { slug: "plan", contents: born.contents, expectedRevision: null });
    await expect(
      bridge("memex_write_chat", { slug: "plan", contents: born.contents, expectedRevision: null }),
    ).rejects.toThrow(/already exists/);
    const read = (await bridge("memex_read_chat", { slug: "plan" })) as {
      contents: string;
      revision: string;
    };
    expect(read.contents).toContain("**you**");
    const next = appendMessages(read.contents, [{ speaker: "rotli", text: "hello" }], DATE);
    await bridge("memex_write_chat", { slug: "plan", contents: next, expectedRevision: read.revision });
    await expect(
      bridge("memex_write_chat", { slug: "plan", contents: next, expectedRevision: read.revision }),
    ).rejects.toThrow(/another tab/);
    const list = await store.list();
    expect(list.map((c) => [c.slug, c.title])).toEqual([["plan", "Plan"]]);
    await store.remove("plan");
    expect(await store.list()).toEqual([]);
    await expect(bridge("memex_rename_chat", { slug: "plan" })).rejects.toThrow(/not available/);
  });

  test("the folder manifest is empty at first and revision-gated after", async () => {
    const store = createWebChatStore(new MemoryVaultStore());
    const first = await store.folders();
    expect(first).toEqual({ contents: "", revision: "0" });
    const rev = await store.writeFolders("{}", "0");
    expect((await store.folders()).revision).toBe(rev);
  });
});
