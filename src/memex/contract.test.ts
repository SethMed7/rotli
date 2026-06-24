// Byte-equality tests for the memex contract mirror. These are the guard that
// keeps src/memex/contract.ts identical to smBrain's conversations.ts / mounts.ts
// (which we must NOT import). If smBrain bumps the contract or changes a shape,
// these fail first — re-sync contract.ts, don't loosen the test.

import { describe, expect, test } from "bun:test";
import {
  appendMessages,
  canWrite,
  composeChatFile,
  composeInboxLine,
  composeMessageLines,
  composeNewChat,
  contractInRange,
  ensureChatBacklink,
  isMemexId,
  parseAccessMode,
  parseMemexInfo,
  slugify,
} from "./contract";

const DATE = "2026-06-24";

describe("slugify (conversations.ts parity)", () => {
  test("lowercases + dashes runs of non-alphanumerics", () => {
    expect(slugify("Rotli architecture")).toBe("rotli-architecture");
    expect(slugify("  Hello, World!  ")).toBe("hello-world");
  });
  test("caps at 60 chars", () => {
    expect(slugify("a".repeat(80)).length).toBe(60);
  });
});

describe("composeChatFile (byte-exact)", () => {
  test("without attachedTo", () => {
    const out = composeChatFile({ title: "Rotli architecture", source: "rotli" }, DATE);
    expect(out).toBe(
      "---\n" +
        "id: 2026-06-24-rotli-architecture\n" +
        "title: Rotli architecture\n" +
        "source: rotli\n" +
        "attachedTo: \n" +
        "participants: [you]\n" +
        "created: 2026-06-24\n" +
        "updated: 2026-06-24\n" +
        "tags: [chat]\n" +
        "---\n" +
        "\n" +
        "# Rotli architecture\n" +
        "\n" +
        "\n" +
        "## Messages\n",
    );
  });

  test("with attachedTo emits the wikilink + the quote line", () => {
    const out = composeChatFile(
      { title: "Rotli architecture", source: "rotli", attachedTo: "architecture-vision" },
      DATE,
    );
    expect(out).toBe(
      "---\n" +
        "id: 2026-06-24-rotli-architecture\n" +
        "title: Rotli architecture\n" +
        "source: rotli\n" +
        "attachedTo: [[architecture-vision]]\n" +
        "participants: [you]\n" +
        "created: 2026-06-24\n" +
        "updated: 2026-06-24\n" +
        "tags: [chat]\n" +
        "---\n" +
        "\n" +
        "# Rotli architecture\n" +
        "\n" +
        "> attached to [[architecture-vision]]\n" +
        "\n" +
        "## Messages\n",
    );
  });

  test("rejects a source not on the chats surface", () => {
    expect(() => composeChatFile({ title: "x", source: "history" }, DATE)).toThrow(/not allowed/);
  });
});

describe("messages", () => {
  test("composeMessageLines uses the · / — separators and trails a newline", () => {
    expect(composeMessageLines([{ speaker: "you", text: "first thought" }], DATE)).toBe(
      "**you** · 2026-06-24 — first thought\n",
    );
  });

  test("appendMessages appends + bumps updated, leaves created", () => {
    const base = composeChatFile({ title: "Rotli architecture", source: "rotli" }, DATE);
    const out = appendMessages(base, [{ speaker: "you", text: "first thought" }], "2026-06-25");
    expect(out.endsWith("## Messages\n**you** · 2026-06-25 — first thought\n")).toBe(true);
    expect(out).toContain("updated: 2026-06-25");
    expect(out).toContain("created: 2026-06-24");
    expect(out).not.toContain("updated: 2026-06-24");
  });

  test("composeNewChat folds initial messages into the fresh file", () => {
    const { slug, contents } = composeNewChat(
      { title: "Rotli architecture", source: "rotli" },
      [{ speaker: "you", text: "hi" }],
      DATE,
    );
    expect(slug).toBe("rotli-architecture");
    expect(contents.endsWith("## Messages\n**you** · 2026-06-24 — hi\n")).toBe(true);
  });
});

describe("ensureChatBacklink (bidirectional ## Chat)", () => {
  test("no-op when the slug is already linked", () => {
    const body = "# Note\n\nhas [[my-chat]] already\n";
    expect(ensureChatBacklink(body, "my-chat")).toBe(body);
  });
  test("inserts under an existing ## Chat heading", () => {
    const body = "# Note\n\ntext\n\n## Chat\n- [[old]]\n";
    expect(ensureChatBacklink(body, "new")).toBe("# Note\n\ntext\n\n## Chat\n- [[new]]\n- [[old]]\n");
  });
  test("appends a new ## Chat section when absent", () => {
    const body = "# Note\n\nbody\n";
    expect(ensureChatBacklink(body, "new")).toBe("# Note\n\nbody\n\n## Chat\n- [[new]]\n");
  });
});

describe("composeInboxLine", () => {
  test("plain", () => expect(composeInboxLine("hello")).toBe("- hello\n"));
  test("tagged", () => expect(composeInboxLine("hello", "watch")).toBe("- watch: hello\n"));
});

describe("parseAccessMode (fail-closed, mounts.ts parity)", () => {
  const reg = (mode?: string) =>
    JSON.stringify({ version: 2, primary: "seth", users: [{ name: "seth" }], ...(mode ? { mode } : {}) });
  test("absent/unreadable users.json ⇒ local", () => {
    expect(parseAccessMode("")).toBe("local");
    expect(parseAccessMode("not json")).toBe("local");
  });
  test("no registry shape ⇒ local", () => {
    expect(parseAccessMode(JSON.stringify({ primary: "seth" }))).toBe("local");
  });
  test("explicit local|open ⇒ that (case/space tolerant)", () => {
    expect(parseAccessMode(reg("open"))).toBe("open");
    expect(parseAccessMode(reg(" LOCAL "))).toBe("local");
  });
  test("explicit secure, missing, or malformed ⇒ secure", () => {
    expect(parseAccessMode(reg("secure"))).toBe("secure");
    expect(parseAccessMode(reg())).toBe("secure");
    expect(parseAccessMode(reg("banana"))).toBe("secure");
  });
});

describe("parseMemexInfo + isMemexId", () => {
  test("valid card", () => {
    const info = parseMemexInfo(JSON.stringify({ id: "mx_abc", contract: "3.4", createdAt: "x", apps: {} }));
    expect(info?.id).toBe("mx_abc");
  });
  test("no string id ⇒ null", () => {
    expect(parseMemexInfo(JSON.stringify({ contract: "3.4" }))).toBeNull();
    expect(parseMemexInfo("nope")).toBeNull();
  });
  test("isMemexId requires the mx_ marker", () => {
    expect(isMemexId("mx_23e4")).toBe(true);
    expect(isMemexId("abc")).toBe(false);
    expect(isMemexId(null)).toBe(false);
  });
});

describe("contractInRange", () => {
  test("rotli's band is exactly its shipped version by default", () => {
    expect(contractInRange("3.4")).toBe(true);
    expect(contractInRange("3.5")).toBe(false);
    expect(contractInRange("3.3")).toBe(false);
  });
  test("can widen the band", () => {
    expect(contractInRange("3.5", "3.4", "3.6")).toBe(true);
  });
});

describe("canWrite (mirror of the Rust write-guard)", () => {
  test("chats/** and inbox.md are writable under chats+inbox", () => {
    expect(canWrite("chats/foo.md", "chats+inbox")).toBe(true);
    expect(canWrite("inbox.md", "chats+inbox")).toBe(true);
  });
  test("wiki/self/history/MAP are never writable in stage 1", () => {
    expect(canWrite("wiki/x.md", "chats+inbox")).toBe(false);
    expect(canWrite("self/x.md", "chats+inbox")).toBe(false);
    expect(canWrite("history/2026/x.md", "chats+inbox")).toBe(false);
    expect(canWrite("MAP.md", "chats+inbox")).toBe(false);
  });
  test("read-only perms forbid everything", () => {
    expect(canWrite("chats/foo.md", "read-only")).toBe(false);
  });
});
