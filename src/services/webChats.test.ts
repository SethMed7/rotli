import { describe, expect, test } from "bun:test";

import { MemoryVaultStore } from "../lib/browserVault";
import { protectionMark } from "../lib/frontmatterBlock";
import { loosened, protection } from "../lib/protectionRule";
import { appendMessages, composeNewChat } from "../memex/contract";
import { MemoryVaultDir } from "./vaultDir";
import { type ChatStore, FolderChatStore, createWebChatStore, webMemexBridge } from "./webChats";

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

test("trashing chats with the same name keeps each file under a name a chat can have", async () => {
  const dir = new MemoryVaultDir();
  const store = new FolderChatStore(dir);
  for (const text of ["first", "second", "third"]) {
    const chat = composeNewChat(
      { title: "Plan", source: "rotli", slug: "plan" },
      [{ speaker: "you", text }],
      DATE,
    );
    await store.write("plan", chat.contents, null);
    await store.remove("plan", "trash");
  }
  expect(await dir.readText("chats/trash/plan.md")).toContain("first");
  expect(await dir.readText("chats/trash/plan-2.md")).toContain("second");
  expect(await dir.readText("chats/trash/plan-3.md")).toContain("third");
});

test("a Trash name taken between the look and the move moves on, and other refusals are reported", async () => {
  const dir = new MemoryVaultDir();
  const store = new FolderChatStore(dir);
  const chat = composeNewChat(
    { title: "Plan", source: "rotli", slug: "plan" },
    [{ speaker: "you", text: "mine" }],
    DATE,
  );
  await store.write("plan", chat.contents, null);
  await dir.writeText("chats/trash/plan.md", "another tab's chat");
  await store.remove("plan", "trash");
  expect(await dir.readText("chats/trash/plan.md")).toBe("another tab's chat");
  expect(await dir.readText("chats/trash/plan-2.md")).toContain("mine");

  await store.write("plan", chat.contents, null);
  const move = dir.move.bind(dir);
  dir.move = async () => {
    throw new Error("disk is read-only");
  };
  await expect(store.remove("plan", "trash")).rejects.toThrow("disk is read-only");
  dir.move = move;
  expect(await dir.exists("chats/plan.md")).toBe(true);
});

test("folder listings find a reply beyond the metadata head, ignoring a later pending send", async () => {
  const dir = new MemoryVaultDir();
  const born = composeNewChat(
    { title: "Long planning chat", source: "rotli", slug: "long-plan" },
    [
      { speaker: "you", at: "2026-10-20T10:00:00Z", text: "Question" },
      { speaker: "rotli", at: "2026-10-20T10:01:00Z", text: "Earlier reply\n" + "More detail\n".repeat(60) },
      { speaker: "rotli", at: "2026-10-21T10:01:00Z", text: "Newest reply" },
      { speaker: "you", at: "2026-10-22T10:00:00Z", text: "Still waiting" },
    ],
    "2026-10-22",
  );
  await dir.writeText("chats/long-plan.md", born.contents);
  const [listed] = await new FolderChatStore(dir).list();
  expect(listed?.title).toBe("Long planning chat");
  expect(listed?.repliedMs).toBe(Date.parse("2026-10-21T10:01:00Z"));
  expect(await dir.readText("chats/long-plan.md")).toBe(born.contents);
});

test("a long transcript without a reply retains the no-reply fallback", async () => {
  const dir = new MemoryVaultDir();
  const born = composeNewChat(
    { title: "Pending plan", source: "rotli", slug: "pending-plan" },
    [{ speaker: "you", at: "2026-10-22T10:00:00Z", text: "Question\n" + "More detail\n".repeat(60) }],
    DATE,
  );
  await dir.writeText("chats/pending-plan.md", born.contents);
  const [listed] = await new FolderChatStore(dir).list();
  expect(listed?.repliedMs).toBe(0);
  expect(listed?.modifiedMs).toBeGreaterThan(0);
});
test("a CRLF chat keeps its saved title, pin, model and provider in the folder listing", async () => {
  const dir = new MemoryVaultDir();
  const contents = [
    "---",
    "title: Week plan",
    "source: rotli",
    "pinned: true",
    "model: fixture-model",
    "provider: fixture-provider",
    "attachedTo: [[weekly-note]]",
    "---",
    "",
    "# Week plan",
    "",
  ].join("\r\n");
  await dir.writeText("chats/week-plan.md", contents);
  const [listed] = await new FolderChatStore(dir).list();
  expect(listed).toMatchObject({
    title: "Week plan",
    source: "rotli",
    pinned: true,
    model: "fixture-model",
    provider: "fixture-provider",
    attachedTo: "weekly-note",
  });
  expect(await dir.readText("chats/week-plan.md")).toBe(contents);
});

test("a CRLF header closing on line 41 still exposes its final pin field", async () => {
  const dir = new MemoryVaultDir();
  const contents = [
    "---",
    "title: Boundary plan",
    ...Array.from({ length: 37 }, (_, i) => `custom_${i}: kept`),
    "pinned: true",
    "---",
    "",
    "# Boundary plan",
  ].join("\r\n");
  await dir.writeText("chats/boundary-plan.md", contents);
  const [listed] = await new FolderChatStore(dir).list();
  expect(listed).toMatchObject({ title: "Boundary plan", pinned: true });
  expect(await dir.readText("chats/boundary-plan.md")).toBe(contents);
});

test("frontmatter-shaped text in a chat body remains body text", async () => {
  const dir = new MemoryVaultDir();
  await dir.writeText("chats/body-only.md", "# Body\r\n\r\ntitle: Not metadata\r\npinned: true\r\n");
  const [listed] = await new FolderChatStore(dir).list();
  expect(listed).toMatchObject({ title: "body-only", pinned: false });
});

describe("a chat re-save keeps its protection (review 2026-11-20)", () => {
  const PROTECTED =
    "---\ntitle: Guarded\nlocked: true\nsecure: true\nsecureContext: true\n---\n\nfirst turn\n";
  const DROPPED = "---\ntitle: Web transcript\n---\n\nyou: hello\n\nrotli: a reply\n";

  const stores: [string, () => ChatStore][] = [
    ["browser", () => createWebChatStore(new MemoryVaultStore())],
    ["folder", () => new FolderChatStore(new MemoryVaultDir())],
  ];

  for (const [name, make] of stores) {
    test(`${name}: locked, secure and secureContext survive a rewrite that drops them`, async () => {
      const store = make();
      await store.write("web-transcript", PROTECTED, null);
      const opened = await store.read("web-transcript");
      await store.write("web-transcript", DROPPED, opened.revision);
      const saved = (await store.read("web-transcript")).contents;
      expect(protection(saved)).toMatchObject({ locked: true, secure: true, secureContext: true });
      expect(saved).toContain("rotli: a reply");
    });

    test(`${name}: a rewrite keeps its denials and cannot grant itself AI access`, async () => {
      const store = make();
      const denied =
        "---\ntitle: No local\ncreated_by: chat\nai_edit: false\nlocal_ai_allowed: false\n---\n\nyou: hi\n";
      await store.write("no-local", denied, null);
      let opened = await store.read("no-local");
      await store.write(
        "no-local",
        "---\ntitle: No local\ncreated_by: chat\n---\n\nyou: hi\n",
        opened.revision,
      );
      expect(loosened(denied, (await store.read("no-local")).contents)).toEqual([]);

      await store.write("granting", "---\ntitle: Granting\n---\n", null);
      opened = await store.read("granting");
      await expect(
        store.write("granting", "---\nlocal_ai_allowed: true\n---\n", opened.revision),
      ).rejects.toThrow(/local_ai_allowed/);
    });
  }
});

describe("chat restores after the self-review at d0c659dd", () => {
  for (const [name, make] of [
    ["browser", () => createWebChatStore(new MemoryVaultStore())],
    ["folder", () => new FolderChatStore(new MemoryVaultDir())],
  ] as const) {
    test(`${name}: an unclosed taint stays on a rewrite`, async () => {
      const store: ChatStore = make();
      await store.write("open-taint", "---\ntitle: Web open\nsecureContext: true\n\nyou: hi\n", null);
      const opened = await store.read("open-taint");
      await store.write("open-taint", "you: hi\n", opened.revision);
      expect(protectionMark((await store.read("open-taint")).contents, "secureContext")).toBe(true);
    });

    test(`${name}: a restore never rewrites block text`, async () => {
      const store: ChatStore = make();
      await store.write("web-block", "---\ntitle: Web block\nlocked: true\n---\n\nyou: hi\n", null);
      const opened = await store.read("web-block");
      await store.write(
        "web-block",
        "---\ntitle: Web block\nnote: |\n  locked: false\n---\n\nyou: hi\n",
        opened.revision,
      );
      const saved = (await store.read("web-block")).contents;
      expect(saved).toContain("note: |\n  locked: false\n");
      expect(protection(saved).locked).toBe(true);
    });
  }
});

// Chat audit 2026-11-24, D1: a create is exclusive in every store, so two
// writers racing for one name can't both win, and the loser hears the name is
// taken (writeChat then moves to the next free name).
for (const [name, make] of [
  ["browser", () => createWebChatStore(new MemoryVaultStore())],
  ["folder", () => new FolderChatStore(new MemoryVaultDir())],
] as const) {
  test(`${name}: two creates racing for one name keep the winner's file`, async () => {
    const store: ChatStore = make();
    const chat = (text: string) =>
      composeNewChat({ title: "Hi", source: "rotli", slug: "hi" }, [{ speaker: "you", text }], DATE).contents;
    const results = await Promise.allSettled([
      store.write("hi", chat("one"), null),
      store.write("hi", chat("two"), null),
    ]);
    const won = results.findIndex((r) => r.status === "fulfilled");
    const lost = results.find((r) => r.status === "rejected");
    expect(won).toBeGreaterThanOrEqual(0);
    expect(String(lost?.reason)).toMatch(/chat already exists/);
    expect((await store.read("hi")).contents).toContain(won === 0 ? "— one" : "— two");
  });
}

// Chat audit 2026-11-24, D2 on the web: the browser store kept one Trash (and
// one Archive) copy per name, so a second removal replaced the first.
test("browser: removing a second chat with the same name keeps the first one's transcript", async () => {
  const store = createWebChatStore(new MemoryVaultStore());
  for (const bin of ["trash", "archive"] as const) {
    for (const text of ["first", "second", "third"]) {
      const chat = composeNewChat(
        { title: "Plan", source: "rotli", slug: "plan" },
        [{ speaker: "you", text }],
        DATE,
      );
      await store.write("plan", chat.contents, null);
      await store.remove("plan", bin);
    }
    expect(await store.recoverable("plan", bin)).toContain("— first");
    expect(await store.recoverable("plan-2", bin)).toContain("— second");
    expect(await store.recoverable("plan-3", bin)).toContain("— third");
  }
});
