// Byte-equality tests for the memex contract mirror. These are the guard that
// keeps src/memex/contract.ts identical to memex-vault's conversations.ts / mounts.ts
// (which we must NOT import). If memex-vault bumps the contract or changes a shape,
// these fail first — re-sync contract.ts, don't loosen the test.

import { describe, expect, test } from "bun:test";
import {
  AI_KEYS,
  USER_KEYS,
  appendMessages,
  canFile,
  canWrite,
  composeChatFile,
  mayFile,
  composeMessageLines,
  composeNewChat,
  composeNote,
  contractInRange,
  ensureChatBacklink,
  isMemexId,
  noteStem,
  parseAccessMode,
  parseMemexInfo,
  parsePrimaryUser,
  setAttachedTo,
  setChatPinned,
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

describe("setAttachedTo (the lazy chat↔note link)", () => {
  test("rewrites the existing attachedTo line in place", () => {
    const base = composeChatFile({ title: "Rotli architecture", source: "rotli" }, DATE);
    const out = setAttachedTo(base, "rotli-architecture-x1y2z3");
    expect(out).toContain("attachedTo: [[rotli-architecture-x1y2z3]]");
    // exactly one attachedTo line survives
    expect(out.match(/^attachedTo:/gm)?.length).toBe(1);
    // nothing else moved
    expect(out).toContain("title: Rotli architecture");
    expect(out).toContain("## Messages");
  });

  test("inserts the line into a foreign frontmatter that lacks it", () => {
    const foreign = "---\ntitle: Imported\n---\n\nbody\n";
    const out = setAttachedTo(foreign, "note-abc123");
    expect(out).toBe("---\ntitle: Imported\nattachedTo: [[note-abc123]]\n---\n\nbody\n");
  });

  test("never touches an attachedTo-shaped line in the BODY", () => {
    const base =
      composeChatFile({ title: "T", source: "rotli" }, DATE) + "attachedTo: [[decoy]]\n";
    const out = setAttachedTo(base, "real-stem-abc123");
    expect(out).toContain("attachedTo: [[decoy]]"); // the body line survives untouched
    expect(out).toContain("attachedTo: [[real-stem-abc123]]"); // the frontmatter one is set
  });

  test("a file without frontmatter is left byte-identical", () => {
    const bare = "# just a body\n";
    expect(setAttachedTo(bare, "x")).toBe(bare);
  });
});

describe("setChatPinned (sidebar pin-to-top)", () => {
  test("inserts pinned: true, rewrites in place, and unpin flips it", () => {
    const base = "---\ntitle: T\n---\n\nbody\n";
    const pinned = setChatPinned(base, true);
    expect(pinned).toBe("---\ntitle: T\npinned: true\n---\n\nbody\n");
    const unpinned = setChatPinned(pinned, false);
    expect(unpinned).toContain("pinned: false");
    expect(unpinned.match(/^pinned:/gm)?.length).toBe(1);
  });

  test("unpinning a never-pinned chat is a no-op; no frontmatter → byte-identical", () => {
    const base = "---\ntitle: T\n---\n\nbody\n";
    expect(setChatPinned(base, false)).toBe(base);
    const bare = "# just a body\npinned: true\n";
    expect(setChatPinned(bare, true)).toBe(bare); // a body line never matches
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
  test("rotli's default band is [3.4, 3.7] — prior cards + the v3.6/v3.7 brain pass", () => {
    expect(contractInRange("3.4")).toBe(true); // an older memex.json
    expect(contractInRange("3.5")).toBe(true); // the prior engine version
    expect(contractInRange("3.6")).toBe(true); // memex-vault after the identity/personality + org split
    expect(contractInRange("3.7")).toBe(true); // v3.7 — the AI Filer lane (still in-band)
    expect(contractInRange("3.3")).toBe(false); // older than rotli supports
    expect(contractInRange("3.8")).toBe(false); // newer than rotli was built for
  });
  test("can widen the band", () => {
    expect(contractInRange("3.6", "3.4", "3.6")).toBe(true);
  });
});

describe("the AI Filer lane (v3.7) — mirror of Rust filer_writable/AI_KEYS", () => {
  test("canFile: only the brain", () => {
    expect(canFile("wiki/Projects/x.md")).toBe(true);
    expect(canFile("wiki/_inbox/x.md")).toBe(true);
    expect(canFile("wiki")).toBe(true);
    expect(canFile("chats/x.md")).toBe(false);
    expect(canFile("inbox.md")).toBe(false);
    expect(canFile("wiki/../etc")).toBe(false);
  });
  test("the user lane and the filer lane are DISJOINT", () => {
    // user writes chats/_inbox, never the curated brain; the filer the reverse
    expect(canWrite("wiki/Projects/x.md", "chats+inbox")).toBe(false);
    expect(canFile("wiki/Projects/x.md")).toBe(true);
    expect(canWrite("chats/x.md", "chats+inbox")).toBe(true);
    expect(canFile("chats/x.md")).toBe(false);
  });
  test("mayFile honors locked + area vocab", () => {
    const vocab = ["Projects", "People"];
    expect(mayFile({ area: "Projects" }, vocab)).toBe(true);
    expect(mayFile({ locked: true, area: "Projects" }, vocab)).toBe(false);
    expect(mayFile({ area: "Nonsense" }, vocab)).toBe(false);
    expect(mayFile({}, vocab)).toBe(true);
  });
  test("AI_KEYS and USER_KEYS are disjoint", () => {
    for (const k of USER_KEYS) expect(AI_KEYS as readonly string[]).not.toContain(k);
  });
});

describe("canWrite (mirror of the Rust write-guard)", () => {
  test("chats/** is writable under chats+inbox; inbox.md is NOT a rotli surface (#96)", () => {
    expect(canWrite("chats/foo.md", "chats+inbox")).toBe(true);
    // no rotli code has ever appended inbox.md (captures stage in wiki/_inbox/) —
    // the dead allowance was narrowed out (audit 2026-07 #96)
    expect(canWrite("inbox.md", "chats+inbox")).toBe(false);
  });
  test("wiki/_inbox staging is writable (v3.5); the rest of wiki + identity/personality/history/MAP are not", () => {
    expect(canWrite("wiki/_inbox/pricing-decision-01jtes.md", "chats+inbox")).toBe(true);
    expect(canWrite("wiki/_inbox", "chats+inbox")).toBe(true);
    expect(canWrite("wiki/x.md", "chats+inbox")).toBe(false); // curated wiki — read-only
    expect(canWrite("wiki/projects/x.md", "chats+inbox")).toBe(false);
    expect(canWrite("identity/x.md", "chats+inbox")).toBe(false);
    expect(canWrite("personality/x.md", "chats+inbox")).toBe(false);
    expect(canWrite("history/2026/x.md", "chats+inbox")).toBe(false);
    expect(canWrite("MAP.md", "chats+inbox")).toBe(false);
  });
  test("no traversal out of the staging dir", () => {
    expect(canWrite("wiki/_inbox/../note.md", "chats+inbox")).toBe(false);
  });
  test("read-only perms forbid everything", () => {
    expect(canWrite("chats/foo.md", "read-only")).toBe(false);
    expect(canWrite("wiki/_inbox/x.md", "read-only")).toBe(false);
  });
});

describe("composeNote (v3.5 note contract — byte-exact)", () => {
  const ID = "01JTESTAAAAAAAAAAAAAAAAAAAA";
  test("frontmatter anchors set, AI metadata blank, body appended with a trailing newline", () => {
    const out = composeNote(
      { id: ID, title: "Pricing decision", shelf: ["Inbox"], reach: ["seth"] },
      "# Pricing decision\n\nFree local forever.", // no trailing newline → composeNote adds one
      DATE,
    );
    expect(out).toBe(
      "---\n" +
        `id: ${ID}\n` +
        "owner: rotli\n" +
        "created: 2026-06-24\n" +
        "updated: 2026-06-24\n" +
        "area:\n" +
        "summary:\n" +
        "tags: []\n" +
        "links:\n" +
        "shelf: [Inbox]\n" +
        "reach: [seth]\n" +
        "---\n" +
        "# Pricing decision\n" +
        "\n" +
        "Free local forever.\n",
    );
  });
  test("multi-shelf, empty reach (owner-only), and a set area", () => {
    const out = composeNote(
      { id: ID, title: "x", shelf: ["Myela/Payments", "Work"], reach: [], area: "projects/myela" },
      "# x\n",
      DATE,
    );
    expect(out).toContain("shelf: [Myela/Payments, Work]\n");
    expect(out).toContain("reach: []\n");
    expect(out).toContain("area: projects/myela\n");
  });
  test("secure creation writes policy metadata without granting local AI", () => {
    const out = composeNote(
      { id: ID, title: "Private", shelf: ["Secure notes"], reach: [], secure: true },
      "# Private\n",
      DATE,
    );
    expect(out).toContain("secure: true\n---\n");
    expect(out).not.toContain("local_ai_allowed");
  });
});

describe("noteStem (home() staging filename)", () => {
  test("slug + the LAST-6-of-id (random tail), lowercased", () => {
    expect(noteStem("Pricing decision", "01JTESTAAAQRSTV")).toBe("pricing-decision-aqrstv");
  });
  test("empty/symbol-only title falls back to 'note' (never a leading dash)", () => {
    expect(noteStem("", "01JABCDXYZ012")).toBe("note-xyz012");
    expect(noteStem("!!!", "01JABCDXYZ012")).toBe("note-xyz012");
  });
  test("same title, different ids ⇒ distinct stems (no overwrite) even ms apart", () => {
    // two ULIDs sharing the time prefix but differing in the random tail
    const a = "01JTESTAAAA" + "AAAAAA";
    const b = "01JTESTAAAA" + "BBBBBB";
    expect(noteStem("Pricing decision", a)).not.toBe(noteStem("Pricing decision", b));
  });
});

describe("parsePrimaryUser (reach default)", () => {
  test("returns users.json primary", () => {
    expect(parsePrimaryUser(JSON.stringify({ primary: "seth", users: [] }))).toBe("seth");
  });
  test("single-tenant / unreadable ⇒ null", () => {
    expect(parsePrimaryUser("{}")).toBeNull();
    expect(parsePrimaryUser("nope")).toBeNull();
    expect(parsePrimaryUser(JSON.stringify({ primary: "" }))).toBeNull();
  });
});
