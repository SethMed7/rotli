// Lockstep locks for the full-text search grammar: these vectors MIRROR the
// Rust tests (corpus.rs search_match_* / sort_hits) — a drift here means the
// browser twin ranks/frames a hit differently than the shell.

import { describe, expect, test } from "bun:test";

import type { SearchHit } from "../types";
import { searchMatch, sortHits } from "./search";

const hit = (over: Partial<SearchHit>): SearchHit => ({
  id: "a",
  title: "t",
  snippet: "",
  folderId: "Inbox",
  kind: "note",
  rank: 1,
  matchStart: 0,
  matchLen: 1,
  updatedAt: 0,
  ...over,
});

describe("searchMatch — title > body ranking with char offsets (mirrors Rust)", () => {
  test("ranks a title hit 0, offsets index the TITLE, stored snippet rides through", () => {
    const m = searchMatch("groc", "Groceries", "# Groceries\n\nOlive oil.\n", "Olive oil.");
    expect(m).toEqual({ rank: 0, snippet: "Olive oil.", matchStart: 0, matchLen: 4 });
  });

  test("ranks a body hit 1 and frames the match inside the returned snippet", () => {
    const m = searchMatch(
      "sourdough",
      "Groceries",
      "# Groceries\n\nOlive oil, sourdough, butter.\n",
      "Olive oil, sourdough, butter.",
    );
    expect(m?.rank).toBe(1);
    const chars = [...(m?.snippet ?? "")];
    expect(chars.slice(m!.matchStart, m!.matchStart + m!.matchLen).join("")).toBe("sourdough");
  });

  test("matches case-insensitively both directions; no match / blank query → null", () => {
    expect(searchMatch("OLIVE", "Groceries", "olive oil", "")).not.toBeNull();
    expect(searchMatch("olive", "Groceries", "OLIVE OIL", "")).not.toBeNull();
    expect(searchMatch("zebra", "Groceries", "olive oil", "")).toBeNull();
    expect(searchMatch("   ", "Groceries", "olive oil", "")).toBeNull();
  });

  test("clips a deep body match to ±60 chars with … on both edges (Rust vector)", () => {
    const long = "a".repeat(100) + "NEEDLE" + "b".repeat(100);
    const m = searchMatch("needle", "T", long, "");
    expect(m?.snippet.startsWith("…")).toBe(true);
    expect(m?.snippet.endsWith("…")).toBe(true);
    const chars = [...(m?.snippet ?? "")];
    expect(chars.slice(m!.matchStart, m!.matchStart + m!.matchLen).join("")).toBe("NEEDLE");
    expect(chars).toHaveLength(1 + 60 + 6 + 60 + 1);
  });

  test("strips emphasis OUTSIDE the match and flattens newlines — offsets stay true", () => {
    const m = searchMatch("needle", "T", "**bold**\nneedle `x`", "");
    const chars = [...(m?.snippet ?? "")];
    expect(chars.slice(m!.matchStart, m!.matchStart + m!.matchLen).join("")).toBe("needle");
    expect(m?.snippet).not.toContain("*");
    expect(m?.snippet).not.toContain("`");
    expect(m?.snippet).not.toContain("\n");
  });

  test("offsets are code points, not UTF-16 units (astral chars before the match)", () => {
    const m = searchMatch("needle", "T", "😀😀 needle", "");
    const chars = [...(m?.snippet ?? "")];
    expect(chars.slice(m!.matchStart, m!.matchStart + m!.matchLen).join("")).toBe("needle");
  });
});

describe("sortHits — rank asc, then recency desc, then id (mirrors Rust sort_hits)", () => {
  test("puts title hits first, newest first inside a rank", () => {
    const sorted = sortHits([
      hit({ id: "old-body", rank: 1, updatedAt: 10 }),
      hit({ id: "new-body", rank: 1, updatedAt: 20 }),
      hit({ id: "title", rank: 0, updatedAt: 1 }),
    ]);
    expect(sorted.map((h) => h.id)).toEqual(["title", "new-body", "old-body"]);
  });
});
