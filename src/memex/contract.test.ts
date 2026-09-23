// Byte-equality tests for the memex contract mirror. These are the guard that
// keeps src/memex/contract.ts identical to memex-vault's conversations.ts / mounts.ts
// (which we must NOT import). If memex-vault bumps the contract or changes a shape,
// these fail first — re-sync contract.ts, don't loosen the test.

import { describe, expect, test } from "bun:test";

import { summarize } from "../services/webChats";
import { setChatModel } from "./chatModelFrontmatter";
import {
  AI_KEYS,
  USER_KEYS,
  addChatArtifact,
  addChatArtifactTurn,
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
  noteSlugify,
  parseChatArtifacts,
  parseChatArtifactTurns,
  parseAccessMode,
  parseMemexInfo,
  parsePrimaryUser,
  setAttachedTo,
  setChatPinned,
  setChatTitle,
  setChatSecureContext,
  hasSecureContext,
  slugify,
} from "./contract";

const DATE = "2026-06-24";

describe("slugify (conversations.ts parity)", () => {
  test("lowercases + dashes runs of non-alphanumerics", () => {
    expect(slugify("Rotli architecture")).toBe("rotli-architecture");
    expect(slugify("  Hello, World!  ")).toBe("hello-world");
    expect(slugify("Café résumé")).toBe("caf-r-sum");
    expect(noteSlugify("Café résumé")).toBe("café-résumé");
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

describe("setChatTitle (stable chat identity)", () => {
  test("updates the first frontmatter title and contract-owned H1 only", () => {
    const base =
      composeChatFile({ title: "Old name", source: "rotli" }, DATE) +
      "**assistant** · 2026-06-24 — title: leave this alone\n# and this too\n";
    const out = setChatTitle(base, "  A better   name  ");
    expect(out).toContain("title: A better name\n");
    expect(out).toContain("# A better name\n");
    expect(out).toContain("title: leave this alone\n# and this too\n");
  });

  test("normalizes pasted line breaks and leaves malformed files alone", () => {
    const base = composeChatFile({ title: "Old", source: "rotli" }, DATE);
    expect(setChatTitle(base, "First\nsecond")).toContain("title: First second\n");
    expect(setChatTitle("title: body only\n", "New")).toBe("title: body only\n");
    expect(setChatTitle(base, "   ")).toBe(base);
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
    const base = composeChatFile({ title: "T", source: "rotli" }, DATE) + "attachedTo: [[decoy]]\n";
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

describe("secureContext taint (secure-note reads poison the chat, one-way)", () => {
  test("marks a chat and reads back; marking twice is byte-identical", () => {
    const base = "---\ntitle: T\n---\n\nbody\n";
    expect(hasSecureContext(base)).toBe(false);
    const marked = setChatSecureContext(base);
    expect(marked).toBe("---\ntitle: T\nsecureContext: true\n---\n\nbody\n");
    expect(hasSecureContext(marked)).toBe(true);
    expect(setChatSecureContext(marked)).toBe(marked);
  });

  test("a stale secureContext: false line is rewritten to true, exactly once", () => {
    const base = "---\ntitle: T\nsecureContext: false\n---\n\nbody\n";
    const marked = setChatSecureContext(base);
    expect(marked).toContain("secureContext: true");
    expect(marked.match(/^secureContext:/gm)?.length).toBe(1);
  });

  test("a body line never matches, in either direction", () => {
    const bare = "# just a body\nsecureContext: true\n";
    expect(setChatSecureContext(bare)).toBe(bare); // no frontmatter — untouched
    expect(hasSecureContext(bare)).toBe(false); // and never read as tainted
    const decoy = "---\ntitle: T\n---\n\nsecureContext: true\n";
    expect(hasSecureContext(decoy)).toBe(false);
  });
});

describe("chat artifact references", () => {
  test("adds portable file/canvas references without changing the transcript", () => {
    const base = composeChatFile({ title: "Artifacts", source: "rotli" }, DATE);
    const withImage = addChatArtifact(base, {
      kind: "file",
      id: "storage/chats/artifacts/diagram.png",
    });
    const withDocument = addChatArtifact(withImage, {
      kind: "file",
      id: "storage/rotli/brief.docx",
    });

    expect(parseChatArtifacts(withDocument)).toEqual([
      { kind: "file", id: "storage/chats/artifacts/diagram.png" },
      { kind: "file", id: "storage/rotli/brief.docx" },
    ]);
    expect(withDocument).toContain("## Messages");
    expect(withDocument.match(/^rotliArtifacts:/gm)?.length).toBe(1);
  });

  test("keeps an editable note source typed and labeled for the correct opener", () => {
    const base = composeChatFile({ title: "PDF", source: "rotli" }, DATE);
    const source = {
      kind: "note" as const,
      id: "01SOURCE",
      label: "Quarterly brief — editable source",
    };

    expect(parseChatArtifacts(addChatArtifact(base, source))).toEqual([source]);
  });

  test("is idempotent, replaces malformed metadata, and never reads a body decoy", () => {
    const base =
      '---\ntitle: T\nrotliArtifacts: not-json\n---\n\nrotliArtifacts: [{"kind":"file","id":"body.png"}]\n';
    expect(parseChatArtifacts(base)).toEqual([]);

    const artifact = { kind: "canvas" as const, id: "wiki/diagram.excalidraw" };
    const once = addChatArtifact(base, artifact);
    expect(addChatArtifact(once, artifact)).toBe(once);
    expect(parseChatArtifacts(once)).toEqual([artifact]);
  });

  test("retains the newest artifact when portable metadata reaches its bound", () => {
    let contents = composeChatFile({ title: "Many artifacts", source: "rotli" }, DATE);
    for (let index = 0; index < 101; index += 1) {
      contents = addChatArtifact(contents, { kind: "file", id: `storage/rotli/item-${index}.docx` });
    }
    const artifacts = parseChatArtifacts(contents);
    expect(artifacts).toHaveLength(100);
    expect(artifacts[0]?.id).toBe("storage/rotli/item-1.docx");
    expect(artifacts.at(-1)?.id).toBe("storage/rotli/item-100.docx");
  });

  test("binds artifacts to the assistant turn that created them", () => {
    const base = composeChatFile({ title: "Artifacts", source: "rotli" }, DATE);
    const first = { kind: "file" as const, id: "storage/rotli/first.docx" };
    const second = { kind: "canvas" as const, id: "wiki/second.excalidraw" };
    const contents = addChatArtifactTurn(addChatArtifactTurn(base, 0, [first]), 2, [second]);

    expect(parseChatArtifactTurns(contents)).toEqual([
      { assistant: 0, artifacts: [first] },
      { assistant: 2, artifacts: [second] },
    ]);
    expect(contents).toContain("## Messages");
  });

  test("replacing a turn is idempotent and malformed turn metadata fails closed", () => {
    const malformed = "---\ntitle: T\nrotliArtifactTurns: nope\n---\n\n## Messages\n";
    expect(parseChatArtifactTurns(malformed)).toEqual([]);
    const artifact = { kind: "file" as const, id: "storage/rotli/report.docx" };
    const once = addChatArtifactTurn(malformed, 1, [artifact]);
    expect(addChatArtifactTurn(once, 1, [artifact])).toBe(once);
    expect(parseChatArtifactTurns(once)).toEqual([{ assistant: 1, artifacts: [artifact] }]);
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
  test("rotli's default band is [3.4, 3.8] — prior cards and the readable-query brain pass", () => {
    expect(contractInRange("3.4")).toBe(true); // an older memex.json
    expect(contractInRange("3.5")).toBe(true); // the prior engine version
    expect(contractInRange("3.6")).toBe(true); // memex-vault after the identity/personality + org split
    expect(contractInRange("3.7")).toBe(true); // v3.7 — the AI Filer lane
    expect(contractInRange("3.8")).toBe(true); // v3.8 — readable identity + deterministic queries
    expect(contractInRange("3.3")).toBe(false); // older than rotli supports
    expect(contractInRange("3.9")).toBe(false); // newer than rotli was built for
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
  test("the user lane and the filer lane stay distinct", () => {
    // paths overlap on wiki/ since 2026-08-03 (both may write it); disjointness
    // now lives in KEY ownership (AI_KEYS) — but the filer still never writes chats
    expect(canWrite("wiki/Projects/x.md", "chats+inbox")).toBe(true);
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
  test("all of wiki/ is writable (2026-08-03); identity/personality/history/MAP are not", () => {
    expect(canWrite("wiki/_inbox/pricing-decision-01jtes.md", "chats+inbox")).toBe(true);
    expect(canWrite("wiki/_inbox", "chats+inbox")).toBe(true);
    expect(canWrite("wiki/_secure/private.md", "chats+inbox")).toBe(true);
    expect(canFile("wiki/_secure/private.md")).toBe(false);
    // curated wiki — writable, so a Librarian-filed note stays editable
    expect(canWrite("wiki/x.md", "chats+inbox")).toBe(true);
    expect(canWrite("wiki/projects/x.md", "chats+inbox")).toBe(true);
    expect(canWrite("wiki", "chats+inbox")).toBe(true);
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
    expect(canWrite("wiki/_secure/x.md", "read-only")).toBe(false);
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
        "created: 2026-06-24\n" +
        "updated: 2026-06-24\n" +
        "pinned: false\n" +
        "aliases: []\n" +
        "owner: rotli\n" +
        "shelf: [Inbox]\n" +
        "reach: [seth]\n" +
        "area:\n" +
        "summary:\n" +
        "tags: []\n" +
        "links: []\n" +
        "---\n" +
        "# Pricing decision\n" +
        "\n" +
        "Free local forever.\n",
    );
  });
  test("multi-shelf, empty reach (owner-only), and a set area", () => {
    const out = composeNote(
      { id: ID, title: "x", shelf: ["Northstar/Payments", "Work"], reach: [], area: "projects/northstar" },
      "# x\n",
      DATE,
    );
    expect(out).toContain("shelf: [Northstar/Payments, Work]\n");
    expect(out).toContain("reach: []\n");
    expect(out).toContain("area: projects/northstar\n");
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
  test("uses only the human-readable title slug", () => {
    expect(noteStem("Pricing decision", "01JTESTAAAQRSTV")).toBe("pricing-decision");
  });
  test("empty/symbol-only title falls back to 'note'", () => {
    expect(noteStem("", "01JABCDXYZ012")).toBe("note");
    expect(noteStem("!!!", "01JABCDXYZ012")).toBe("note");
  });
  test("stable ids do not leak into the human filename", () => {
    const a = "01JTESTAAAA" + "AAAAAA";
    const b = "01JTESTAAAA" + "BBBBBB";
    expect(noteStem("Pricing decision", a)).toBe(noteStem("Pricing decision", b));
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

describe("setChatModel (who answers, in the file)", () => {
  test("inserts model and provider into a fresh chat's frontmatter, once", () => {
    const base = composeChatFile({ title: "Gemma chat", source: "rotli" }, DATE);
    const out = setChatModel(base, "gemma-3-12b-it-qat-4bit", "mlx");
    expect(out).toContain("model: gemma-3-12b-it-qat-4bit");
    expect(out).toContain("provider: mlx");
    expect(out.match(/^model:/gm)?.length).toBe(1);
    expect(out).toContain("## Messages");
    // a second write with the same values changes nothing
    expect(setChatModel(out, "gemma-3-12b-it-qat-4bit", "mlx")).toBe(out);
  });

  test("rewrites the lines in place when the chat's model changes", () => {
    const base = setChatModel(composeChatFile({ title: "T", source: "rotli" }, DATE), "sonnet", "claude");
    const out = setChatModel(base, "gemini-3.7-flash-high", "antigravity");
    expect(out).toContain("model: gemini-3.7-flash-high");
    expect(out).toContain("provider: antigravity");
    expect(out).not.toContain("sonnet");
    expect(out.match(/^provider:/gm)?.length).toBe(1);
    // a discovered id with a context suffix survives the write → reread
    const wide = setChatModel(out, "opus[1m]", "claude");
    expect(summarize("t", wide, 0).model).toBe("opus[1m]");
  });

  test("an unknown provider writes no provider line, and removes a stale one", () => {
    const base = composeChatFile({ title: "T", source: "rotli" }, DATE);
    const out = setChatModel(base, "some-local-model", null);
    expect(out).toContain("model: some-local-model");
    expect(out).not.toMatch(/^provider:/m);
    const stale = setChatModel(base, "x", "claude");
    expect(setChatModel(stale, "y", null)).not.toMatch(/^provider:/m);
  });

  test("leaves a file without frontmatter alone", () => {
    expect(setChatModel("# no frontmatter\n", "m", "p")).toBe("# no frontmatter\n");
  });
});
