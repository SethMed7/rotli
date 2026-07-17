import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inlineHtml, stripMarkdown } from "../scripts/markdownText";

// Shared behavioral fixture — the SAME file drives the app-side mirror in
// src/editor/stripMarkdown.test.ts. Parity by fixture, not shared impl: the
// italic cases pin the canonical "emphasis only against non-space content" rule
// render-brief had drifted from.
type Fixture = { cases: Array<{ name: string; input: string; text: string; html: string }> };
const fixture: Fixture = JSON.parse(
  readFileSync(join(import.meta.dir, "../../scripts/fixtures/markdown-strip.json"), "utf8"),
);

describe("markdownText — inlineHtml vs the fixture", () => {
  for (const c of fixture.cases) {
    test(c.name, () => {
      expect(inlineHtml(c.input)).toBe(c.html);
    });
  }

  test("html minus tags equals the stripped text (fixture self-consistency)", () => {
    for (const c of fixture.cases) {
      expect(c.html.replace(/<[^>]+>/g, "")).toBe(c.text);
    }
  });
});

describe("markdownText — stripMarkdown (spoken script cleanup)", () => {
  test("links become text, markers scrubbed", () => {
    expect(stripMarkdown("see [the docs](https://x.com) and **bold**")).toBe("see the docs and bold");
  });

  test("voice markers survive the scrub", () => {
    expect(stripMarkdown("[[anchor]]\nGood **morning**")).toBe("[[anchor]]\nGood morning");
  });

  test("bare URLs and list dashes vanish", () => {
    expect(stripMarkdown("- item one\n- item two")).toBe("item one\nitem two");
  });
});
