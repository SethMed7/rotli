import { describe, expect, test } from "bun:test";

import { MemoryVaultStore } from "../lib/browserVault";
import { appendMessages, composeNewChat } from "../memex/contract";
import { MemoryVaultDir } from "./vaultDir";
import { FolderChatStore, createWebChatStore, webMemexBridge } from "./webChats";

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
    // the transcript is recoverable, and the slug can be born again
    expect(await store.recoverable("plan", "trash")).toContain("**rotli**");
    await bridge("memex_write_chat", { slug: "plan", contents: born.contents, expectedRevision: null });
    expect((await store.list()).map((c) => c.slug)).toEqual(["plan"]);
    await store.remove("plan", "archive");
    expect(await store.list()).toEqual([]);
    expect(await store.recoverable("plan", "archive")).toContain("# Plan");
  });

  test("two chats saved at once both reach the list", async () => {
    const store = createWebChatStore(new MemoryVaultStore());
    const a = composeNewChat(
      { title: "A", source: "rotli", slug: "a" },
      [{ speaker: "you", text: "a" }],
      DATE,
    );
    const b = composeNewChat(
      { title: "B", source: "rotli", slug: "b" },
      [{ speaker: "you", text: "b" }],
      DATE,
    );
    await Promise.all([store.write("a", a.contents, null), store.write("b", b.contents, null)]);
    expect((await store.list()).map((c) => c.slug).sort()).toEqual(["a", "b"]);
  });

  test("the folder manifest is empty at first and revision-gated after", async () => {
    const store = createWebChatStore(new MemoryVaultStore());
    const first = await store.folders();
    expect(first).toEqual({ contents: "", revision: "0" });
    const rev = await store.writeFolders("{}", "0");
    expect((await store.folders()).revision).toBe(rev);
  });

  test("folder mode: chats are the vault's own files, so the app and the web see the same ones", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText(
      "chats/from-the-app.md",
      "---\nid: x\ntitle: From the app\nsource: rotli\nattachedTo: [[plan]]\npinned: true\n---\n\n## Messages\n",
    );
    await dir.writeText("chats/README.md", "not a chat");
    await dir.writeText(
      "chats/no-times.md",
      "---\nid: y\ntitle: Imported\nsource: rotli\nattachedTo:\ncreated: 2026-09-01\nupdated: 2026-09-10\n---\n",
    );
    const store = new FolderChatStore(dir);
    const bridge = webMemexBridge(store);
    const listed = await store.list();
    expect(listed.map((c) => [c.slug, c.title, c.attachedTo, c.pinned, c.path])).toEqual([
      ["from-the-app", "From the app", "plan", true, "chats/from-the-app.md"],
      ["no-times", "Imported", "", false, "chats/no-times.md"],
    ]);
    // the in-memory port stamps a logical clock, not a date: the `updated:` day stands in
    expect(listed[1]!.modifiedMs).toBe(Date.parse("2026-09-10"));
    const born = composeNewChat(
      { title: "Web", source: "rotli", slug: "web" },
      [{ speaker: "you", text: "hi" }],
      DATE,
    );
    await bridge("memex_write_chat", { slug: "web", contents: born.contents, expectedRevision: null });
    expect(await dir.exists("chats/web.md")).toBe(true);
    await expect(store.write("web", born.contents, null)).rejects.toThrow(/already exists/);
    const read = await store.read("web");
    await store.write(
      "web",
      appendMessages(read.contents, [{ speaker: "rotli", text: "hello" }], DATE),
      read.revision,
    );
    await expect(store.write("web", "x", read.revision)).rejects.toThrow(/changed on disk/);
    await expect(store.write("../escape", "x", null)).rejects.toThrow(/not a chat slug/);
    await store.remove("web", "trash");
    expect(await dir.exists("chats/web.md")).toBe(false);
    expect(await dir.exists("chats/trash/web.md")).toBe(true);
    expect(await store.folders()).toEqual({ contents: "", revision: "0" });
    const rev = await store.writeFolders("{}", "0");
    expect(await dir.readText(".rotli/chat-folders.json")).toBe("{}");
    await expect(store.writeFolders("{}", "0")).rejects.toThrow(/changed on disk/);
    expect((await store.folders()).revision).toBe(rev);
  });
});
