import { describe, expect, test } from "bun:test";

import {
  editId,
  editableWatchlist,
  itemIssue,
  normalizedWebsite,
  sectionIssue,
  watchlistDocument,
  watchlistHasIssues,
  websiteDomain,
  type EditableWatchItem,
  type EditableWatchSection,
} from "./breveWatchlistModel";

function item(patch: Partial<EditableWatchItem> = {}): EditableWatchItem {
  return { id: editId(), watch: "Bun", lens: "Releases", url: "https://bun.sh/", ...patch };
}

function section(patch: Partial<EditableWatchSection> = {}): EditableWatchSection {
  return { id: editId(), title: "Runtimes", note: "", items: [item()], ...patch };
}

describe("normalizedWebsite", () => {
  test("accepts bare domains by assuming https", () => {
    expect(normalizedWebsite("bun.sh")).toBe("https://bun.sh/");
  });
  test("keeps explicit http/https URLs", () => {
    expect(normalizedWebsite("http://example.com/x")).toBe("http://example.com/x");
  });
  test("rejects empty, non-web schemes, and junk", () => {
    expect(normalizedWebsite("")).toBeNull();
    expect(normalizedWebsite("   ")).toBeNull();
    expect(normalizedWebsite("ftp://example.com")).toBeNull();
    expect(normalizedWebsite("javascript:alert(1)")).toBeNull();
    expect(normalizedWebsite("not a url at all")).toBeNull();
  });
});

describe("websiteDomain", () => {
  test("shows the bare hostname without www", () => {
    expect(websiteDomain("https://www.anthropic.com/claude-code")).toBe("anthropic.com");
    expect(websiteDomain("bun.sh")).toBe("bun.sh");
  });
  test("is empty for missing or invalid websites", () => {
    expect(websiteDomain(undefined)).toBe("");
    expect(websiteDomain("not a url")).toBe("");
  });
});

describe("itemIssue", () => {
  test("valid topics have no issue", () => {
    expect(itemIssue(item())).toBeNull();
    expect(itemIssue(item({ url: "" }))).toBeNull();
  });
  test("a nameless topic is the row's issue", () => {
    expect(itemIssue(item({ watch: "  " }))).toContain("Name this topic");
  });
  test("an invalid website is the row's issue and quotes the value", () => {
    expect(itemIssue(item({ url: "not a url" }))).toContain("not a url");
  });
});

describe("sectionIssue", () => {
  test("unique named groups have no issue", () => {
    const sections = [section({ title: "A" }), section({ title: "B" })];
    expect(sectionIssue(sections, sections[0]!)).toBeNull();
  });
  test("a nameless group is flagged", () => {
    const sections = [section({ title: " " })];
    expect(sectionIssue(sections, sections[0]!)).toContain("Name this group");
  });
  test("duplicate names are flagged case-insensitively", () => {
    const sections = [section({ title: "Chess" }), section({ title: "chess " })];
    expect(sectionIssue(sections, sections[0]!)).toContain("used more than once");
    expect(sectionIssue(sections, sections[1]!)).toContain("used more than once");
  });
});

describe("watchlistHasIssues", () => {
  test("clean sections save", () => {
    expect(watchlistHasIssues([section()])).toBe(false);
  });
  test("any bad row blocks saving", () => {
    expect(watchlistHasIssues([section({ items: [item({ watch: "" })] })])).toBe(true);
    expect(watchlistHasIssues([section({ title: "" })])).toBe(true);
  });
});

describe("markdown round-trip", () => {
  test("document -> editable -> document is stable", () => {
    const sections = [
      section({
        title: "Runtimes",
        note: "Ship-quality signal only.",
        items: [item(), item({ watch: "Deno", lens: "LTS changes", url: "" })],
      }),
    ];
    const doc = watchlistDocument(sections, "Keep it short.");
    const parsed = editableWatchlist(doc);
    expect(parsed.preferences).toBe("Keep it short.");
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0]!.note).toBe("Ship-quality signal only.");
    expect(parsed.sections[0]!.items.map((entry) => entry.watch)).toEqual(["Bun", "Deno"]);
    expect(watchlistDocument(parsed.sections, parsed.preferences)).toBe(doc);
  });
  test("legacy known topics get their canonical URL back-filled", () => {
    const parsed = editableWatchlist("# W\n\n## G\n\n| Watch | Lens |\n|---|---|\n| Bun | speed |\n");
    expect(parsed.sections[0]!.items[0]!.url).toBe("https://bun.sh/");
  });
});
