import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type NoteFrontmatter,
  composeNoteDocument,
  emptyFrontmatter,
  isLockedFrontmatter,
  isSecureFrontmatter,
  parseNoteDocument,
  shelfOf,
  withShelf,
} from "./frontmatter";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = join(HERE, "..", "..", "src-tauri", "demo-seed", "wiki");
const readSeed = (rel: string): string => readFileSync(join(SEED, rel), "utf8");

/** Seed notes whose frontmatter is already in the canonical order Rotli writes
 * (id, created, updated, pinned, then foreign): parse → compose reproduces the
 * file byte for byte. */
const CANONICAL = [
  "guides/welcome-to-rotli.md",
  "guides/main-and-the-library.md",
  "ideas/note-taking-that-lasts.md",
  "reading/local-first-software.md",
];

/** The two hand-written capture seeds. They carry no `pinned:` line and put
 * `owner:` above `created:`, so the Rust codec itself normalizes them on the
 * first write — a byte-exact first hop is impossible for these by design. */
const NORMALIZED = ["_inbox/try-quick-capture.md", "_inbox/weekend-project.md"];

const roundTrip = (text: string): string => {
  const { frontmatter, body } = parseNoteDocument(text);
  if (!frontmatter) throw new Error("expected frontmatter");
  return composeNoteDocument(frontmatter, body);
};

describe("demo-seed round trips", () => {
  for (const rel of CANONICAL) {
    test(`${rel} composes back to the exact bytes on disk`, () => {
      const original = readSeed(rel);
      expect(roundTrip(original)).toBe(original);
    });
  }

  for (const rel of NORMALIZED) {
    test(`${rel} keeps its body and foreign lines, and is stable after one hop`, () => {
      const original = readSeed(rel);
      const parsed = parseNoteDocument(original);
      const composed = composeNoteDocument(parsed.frontmatter as NoteFrontmatter, parsed.body);
      expect(parsed.body).toBe(original.slice(original.indexOf("\n---\n") + "\n---\n".length));
      expect(parsed.frontmatter?.foreign).toEqual(["owner: rotli", "shelf: Inbox", "reach: private"]);
      expect(parseNoteDocument(composed).body).toBe(parsed.body);
      expect(roundTrip(composed)).toBe(composed);
    });
  }

  test("changing only `updated` changes only that line", () => {
    const original = readSeed("guides/welcome-to-rotli.md");
    const { frontmatter, body } = parseNoteDocument(original);
    const next = composeNoteDocument({ ...(frontmatter as NoteFrontmatter), updated: "2027-01-31" }, body);
    const before = original.split("\n");
    const after = next.split("\n");
    expect(after.length).toBe(before.length);
    const changed = before.map((line, i) => [line, after[i]]).filter(([a, b]) => a !== b);
    expect(changed).toEqual([["updated: 2026-07-07", "updated: 2027-01-31"]]);
  });

  test("every seed note exposes its owned facts", () => {
    const welcome = parseNoteDocument(readSeed("guides/welcome-to-rotli.md")).frontmatter;
    expect(welcome?.id).toBe("demo-welcome");
    expect(welcome?.pinned).toBe(true);
    expect(welcome?.origin).toBeNull();
    const capture = parseNoteDocument(readSeed("_inbox/try-quick-capture.md")).frontmatter;
    expect(capture?.pinned).toBeNull();
    expect(shelfOf(capture as NoteFrontmatter)).toEqual(["Inbox"]);
  });
});

describe("parseNoteDocument", () => {
  test("no fence leaves the whole text as the body", () => {
    const text = "# Plain note\n\nno frontmatter here\n";
    expect(parseNoteDocument(text)).toEqual({ frontmatter: null, body: text });
  });

  test("an unterminated fence is body, not eaten", () => {
    const text = "---\nid: abc\ncreated: 2026-01-01\n\n# Never closed\n";
    expect(parseNoteDocument(text)).toEqual({ frontmatter: null, body: text });
  });

  test("a CRLF opening fence parses and the body keeps its own line endings", () => {
    const result = parseNoteDocument("---\r\nid: abc\r\npinned: true\r\n---\r\n# Title\r\n");
    expect(result.frontmatter?.id).toBe("abc");
    expect(result.frontmatter?.pinned).toBe(true);
    expect(result.body).toBe("# Title\r\n");
  });

  test("a closing fence with trailing spaces does not close the block", () => {
    const text = "---\nid: abc\n--- \n# Title\n";
    expect(parseNoteDocument(text).frontmatter).toBeNull();
  });

  test("a document that ends on the closing fence has an empty body", () => {
    const result = parseNoteDocument("---\nid: abc\n---");
    expect(result.frontmatter?.id).toBe("abc");
    expect(result.body).toBe("");
  });

  test("`origin:` is the empty string, and absent stays null", () => {
    expect(parseNoteDocument("---\norigin:\n---\nx").frontmatter?.origin).toBe("");
    expect(parseNoteDocument("---\norigin: wiki/ideas\n---\nx").frontmatter?.origin).toBe("wiki/ideas");
    expect(parseNoteDocument("---\nid: a\n---\nx").frontmatter?.origin).toBeNull();
  });

  test("pinned is true only for the literal `true`", () => {
    const pinnedOf = (line: string) => parseNoteDocument(`---\n${line}\n---\nx`).frontmatter?.pinned;
    expect(pinnedOf("pinned: true")).toBe(true);
    expect(pinnedOf("pinned: false")).toBe(false);
    expect(pinnedOf("pinned: yes")).toBe(false);
    expect(pinnedOf("pinned:")).toBe(false);
  });

  test("an untrimmed key, and a repeated owned key, stay foreign", () => {
    const fm = parseNoteDocument("---\n id: spaced\nid : spaced\nid: real\nid: second\n---\nx").frontmatter;
    expect(fm?.id).toBe("real");
    expect(fm?.foreign).toEqual([" id: spaced", "id : spaced", "id: second"]);
  });

  test("a keyless line and an interior blank line survive as foreign lines", () => {
    const fm = parseNoteDocument("---\nid: a\nloose text\n\ntags: [x]\n---\nx").frontmatter;
    expect(fm?.foreign).toEqual(["loose text", "", "tags: [x]"]);
  });
});

describe("composeNoteDocument", () => {
  test("owned facts lead, foreign lines follow in order, body is appended raw", () => {
    const fm: NoteFrontmatter = {
      id: "abc",
      created: "2026-01-01",
      updated: "2026-01-02",
      pinned: false,
      origin: null,
      foreign: ["owner: rotli", "tags: [a]"],
    };
    expect(composeNoteDocument(fm, "# Body\n")).toBe(
      "---\nid: abc\ncreated: 2026-01-01\nupdated: 2026-01-02\npinned: false\nowner: rotli\ntags: [a]\n---\n# Body\n",
    );
  });

  test("an absent owned value emits its key with the empty value the Rust codec writes", () => {
    expect(composeNoteDocument(emptyFrontmatter(), "")).toBe(
      "---\nid: \ncreated: \nupdated: \npinned: false\n---\n",
    );
  });

  test("origin is emitted only when present, right after pinned", () => {
    const rooted = composeNoteDocument({ ...emptyFrontmatter(), origin: "" }, "");
    expect(rooted).toContain("pinned: false\norigin: \n---");
    const shelved = composeNoteDocument({ ...emptyFrontmatter(), origin: "wiki/ideas" }, "");
    expect(shelved).toContain("pinned: false\norigin: wiki/ideas\n---");
    expect(composeNoteDocument(emptyFrontmatter(), "")).not.toContain("origin");
  });
});

describe("shelf and flag reads", () => {
  const withForeign = (...foreign: string[]): NoteFrontmatter => ({ ...emptyFrontmatter(), foreign });

  test("shelfOf reads a list, a bare value, and answers [] when absent or empty", () => {
    expect(shelfOf(withForeign("shelf: [Inbox, Northstar/Payments]"))).toEqual([
      "Inbox",
      "Northstar/Payments",
    ]);
    expect(shelfOf(withForeign("shelf: Inbox"))).toEqual(["Inbox"]);
    expect(shelfOf(withForeign("shelf: []"))).toEqual([]);
    expect(shelfOf(withForeign("shelf:"))).toEqual([]);
    expect(shelfOf(emptyFrontmatter())).toEqual([]);
  });

  test("withShelf replaces the existing line in place and appends when there is none", () => {
    const replaced = withShelf(withForeign("owner: rotli", "shelf: Inbox", "tags: []"), ["Ideas"]);
    expect(replaced.foreign).toEqual(["owner: rotli", "shelf: [Ideas]", "tags: []"]);
    const appended = withShelf(withForeign("owner: rotli"), ["Inbox"]);
    expect(appended.foreign).toEqual(["owner: rotli", "shelf: [Inbox]"]);
    expect(shelfOf(appended)).toEqual(["Inbox"]);
  });

  test("secure and locked read their own foreign flag only when it is true", () => {
    expect(isSecureFrontmatter(withForeign("secure: true"))).toBe(true);
    expect(isSecureFrontmatter(withForeign("secure: false"))).toBe(false);
    expect(isSecureFrontmatter(withForeign("secure_origin: true"))).toBe(false);
    expect(isLockedFrontmatter(withForeign("locked: true"))).toBe(true);
    expect(isLockedFrontmatter(withForeign("locked: false"))).toBe(false);
    expect(isLockedFrontmatter(emptyFrontmatter())).toBe(false);
  });
});
