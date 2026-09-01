// Regression locks for the TITLE LAW: title + snippet are DERIVED from the
// body, never stored. As of the parity fix (audit TSP-1/TSP-2), titleOf and
// snippetOf are a faithful port of the Rust corpus (corpus.rs title_of /
// snippet_of) — so a list row (Rust-derived) and an opened/moved note
// (TS-derived) always agree. These cases mirror the Rust test vectors
// (corpus.rs) and MUST stay in lockstep with them.

import { describe, expect, test } from "bun:test";

import { snippetOf, summaryOrder, titleOf } from "./derive";

describe("titleOf — first non-empty line, markdown stripped (mirrors Rust title_of)", () => {
  test("strips a leading #-run", () => {
    expect(titleOf("# Hello world\nrest")).toBe("Hello world");
    expect(titleOf("### Deep\nbody")).toBe("Deep");
  });

  test("the first H1 outranks earlier prose and lower-level headings", () => {
    expect(titleOf("Preface\n## Section\n# Canonical title\nbody")).toBe("Canonical title");
  });

  test("keeps a plain first line untouched", () => {
    expect(titleOf("Plain line\nmore")).toBe("Plain line");
    // checkbox marks peel like every other block prefix — including `[/]`,
    // in progress (2026-08-04). Mirrors the Rust title_of vector.
    expect(titleOf("- [x] ship it\n")).toBe("ship it");
    expect(titleOf("- [/] draft the memo\n")).toBe("draft the memo");
    expect(titleOf("- [ ][x] API fails\n")).toBe("API fails");
    expect(titleOf("- [x][ ] API passes\n")).toBe("API passes");
    expect(titleOf("- (x) Blue\n")).toBe("Blue");
  });

  test("falls back to Untitled only when NOTHING is non-empty", () => {
    expect(titleOf("")).toBe("Untitled");
    expect(titleOf("   \n\t\n")).toBe("Untitled");
  });

  test("skips blank/whitespace leading lines (Rust parity — was the TSP-1 bug)", () => {
    // the TS path used to read only line 0 and return "Untitled"; Rust scans to
    // the first non-empty line. These now agree.
    expect(titleOf("   \nsecond")).toBe("second");
    expect(titleOf("\n# Second line is a heading")).toBe("Second line is a heading");
  });

  test("strips list/checkbox markers and emphasis (the Rust corpus vectors)", () => {
    expect(titleOf("- [x] ship it\n")).toBe("ship it");
    expect(titleOf("\n\n## **Bold** _title_\nrest")).toBe("Bold title");
    expect(titleOf("> quoted heading")).toBe("quoted heading");
  });
});

describe("snippetOf — lines after the title, stripped + joined (mirrors Rust snippet_of)", () => {
  test("joins the lines after the title with single spaces", () => {
    expect(snippetOf("# Title\n\nFirst body line here.\nSecond line.")).toBe(
      "First body line here. Second line.",
    );
  });

  test("strips emphasis chars (* _ `) anywhere, but # and > only when leading", () => {
    // Rust strip_markdown removes * _ ` globally, yet only peels #/> at the
    // START of a line — so a mid-line '>' or '#' survives (the TSP-2 fix: the
    // old TS regex wrongly stripped them everywhere).
    expect(snippetOf("# T\n\n**bold** _ital_ `code` > quote # h")).toBe("bold ital code > quote # h");
  });

  test("strips checkbox + list markers on EVERY line (Rust parity — was the TSP-2 bug)", () => {
    // every body line is stripped, not just the first, so both dashes go.
    expect(snippetOf("# T\n- [x] done\n- [ ] todo")).toBe("done todo");
    expect(snippetOf("# T\n- [ ][ ] pending check\n- [x][ ] passed check")).toBe(
      "pending check passed check",
    );
    expect(snippetOf("# T\n- only item")).toBe("only item");
  });

  test("preserves internal whitespace within a line (Rust does not collapse it)", () => {
    expect(snippetOf("# T\n\n   spaced    out   \n")).toBe("spaced    out");
  });

  test("returns empty when there is nothing past the title", () => {
    expect(snippetOf("# Only title")).toBe("");
    expect(snippetOf("")).toBe("");
  });

  test("caps the snippet at 140 code points", () => {
    expect(snippetOf("# T\n" + "a".repeat(200))).toHaveLength(140);
    // code-point aware: astral chars are not split mid-surrogate
    expect([...snippetOf("# T\n" + "😀".repeat(200))]).toHaveLength(140);
  });
});

describe("image/link reduction — `![alt](url)` → alt, `[text](url)` → text (mirrors Rust reduce_md_links)", () => {
  test("reduces an image to its alt so raw markdown never reads as a title", () => {
    // the "images in All notes" leak: a note starting with an image used to show
    // the literal `![photo](storage:abc.png)` as its title row
    expect(titleOf("![photo](storage:abc.png)\nrest")).toBe("photo");
    expect(titleOf("![](storage:abc.png)\nrest")).toBe("Image");
  });

  test("reduces a link to its text and handles both inside snippets", () => {
    expect(titleOf("[the doc](https://x.y/z)")).toBe("the doc");
    expect(snippetOf("# T\nsee ![chart](a.png) and [spec](b)")).toBe("see chart and spec");
  });

  test("leaves malformed spans untouched (Rust parity)", () => {
    expect(titleOf("[not a link] (gap)")).toBe("[not a link] (gap)");
    expect(titleOf("![dangling](no close")).toBe("![dangling](no close");
  });
});

describe("whitespace alphabet matches Rust char::is_whitespace (not JS trim)", () => {
  // The two code points where JS String.trim() and Rust disagree: JS trim drops
  // U+FEFF (BOM) and keeps U+0085 (NEL); Rust does the opposite. derive.ts must
  // follow Rust so a BOM-prefixed note (external editors emit one) derives the
  // SAME title in a list row (Rust) and an opened tab (TS).
  test("trims a leading NEL (U+0085) like Rust, so the heading still resolves", () => {
    expect(titleOf("# Real heading\nbody")).toBe("Real heading");
  });

  test("does NOT trim a leading BOM (U+FEFF) — matches Rust, which keeps it", () => {
    expect(titleOf("﻿Title from BOM\nbody")).toBe("﻿Title from BOM");
  });
});

// The list-order lockstep (Greptile, PR #13): summaryOrder is a faithful port
// of corpus_list's sort in corpus.rs `list()` — pinned first, updated_at desc,
// id asc. If the Rust sort ever grows a key, this fixture (and derive.ts) must
// move with it, or cache-patched lists visibly reorder on the next refetch.
describe("summaryOrder — the corpus_list sort, ported", () => {
  const row = (id: string, updatedAt: number, pinned = false) => ({ id, updatedAt, pinned });

  test("pinned floats above everything, regardless of recency", () => {
    const sorted = [row("old-pin", 10, true), row("fresh", 999)].sort(summaryOrder);
    expect(sorted.map((r) => r.id)).toEqual(["old-pin", "fresh"]);
  });

  test("within a pin band: updatedAt desc, then id asc as the stable tiebreak", () => {
    const sorted = [row("b", 5), row("c", 9), row("a", 5)].sort(summaryOrder);
    expect(sorted.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
});
