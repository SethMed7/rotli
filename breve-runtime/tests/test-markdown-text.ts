import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeHtmlEntities, escapeHtml, inlineHtml, stripMarkdown } from "../scripts/markdown-text";

// Shared behavioral fixture — the SAME file drives the app-side mirror in
// src/editor/stripMarkdown.test.ts. Parity by fixture, not shared impl: the
// italic cases pin the canonical "emphasis only against non-space content" rule
// render-brief had drifted from.
type Fixture = { cases: Array<{ name: string; input: string; text: string; html: string }> };
const fixture: Fixture = JSON.parse(
  readFileSync(join(import.meta.dir, "../../scripts/fixtures/markdown-strip.json"), "utf8"),
);

describe("markdown-text — inlineHtml vs the fixture", () => {
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

describe("markdown-text — stripMarkdown (spoken script cleanup)", () => {
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

// CodeQL #4/#5 (2026-11-10): safe-fetch's page text and creator-alerts' video
// titles decoded `&amp;` first and then `&lt;`, so a page or title that SHOWED
// the text "&lt;" came out as "<". One pass reads each entity once.
describe("markdown-text — decodeHtmlEntities", () => {
  test("decodes each entity once: an escaped entity stays an entity", () => {
    expect(decodeHtmlEntities("&amp;lt;b&amp;gt; &amp;amp; &amp;#39;")).toBe("&lt;b&gt; &amp; &#39;");
  });

  test("reads the entities pages and feeds use", () => {
    expect(decodeHtmlEntities("Q&amp;A &lt;3 &quot;hi&quot; it&#39;s &apos;x&apos;&nbsp;&#x2192; &#8212;")).toBe(
      `Q&A <3 "hi" it's 'x' → —`,
    );
  });

  test("leaves anything it doesn't know, or that isn't a character, as written", () => {
    expect(decodeHtmlEntities("&rarr; &#xFFFFFFFF; &#0; & alone &;")).toBe("&rarr; &#xFFFFFFFF; &#0; & alone &;");
    // names an object inherits are not entities
    expect(decodeHtmlEntities("&constructor; &toString; &__proto__;")).toBe("&constructor; &toString; &__proto__;");
  });

  test("undoes escapeHtml", () => {
    const text = `a < b && "c" > 'd' &amp;`;
    expect(decodeHtmlEntities(escapeHtml(text))).toBe(text);
  });
});
