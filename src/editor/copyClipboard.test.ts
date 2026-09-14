// A copy keeps the structure you see: numbers, bullets, boxes, nesting, and
// images — as readable text and as real HTML.
import { describe, expect, test } from "bun:test";

import fixture from "../../scripts/fixtures/markdown-strip.json";
import { clipboardHtml, clipboardText, imageSourcesIn, inlineHtml } from "./copyClipboard";

describe("clipboardText", () => {
  test("numbers, bullets, boxes, and nesting survive; inline markers do not", () => {
    const md =
      "1. **Sale**\n2. Sale + *Refund*\n  1. nested\n- item\n- [ ] todo\n- [x] done\n1. ( ) Red\n# Title\n> quote";
    expect(clipboardText(md)).toBe(
      "1. Sale\n2. Sale + Refund\n  1. nested\n- item\n☐ todo\n☑ done\n1. ○ Red\nTitle\nquote",
    );
  });
  test("an image copies as its name (or alt) in brackets", () => {
    expect(clipboardText("![](storage:551.png)\n- ![shot](storage:a/b.jpg)")).toBe(
      "[image: 551.png]\n- [image: shot]",
    );
  });
  test("the strip fixture reads the same through the text lane", () => {
    for (const c of fixture.cases) expect(clipboardText(c.input)).toBe(c.text);
  });
});

describe("clipboardHtml", () => {
  test("a lettered list exports as an ordered list in letters", () => {
    expect(clipboardHtml("a. one\nb. two")).toBe('<ol type="a">\n<li>one</li>\n<li>two</li>\n</ol>');
  });

  test("ordered and unordered lists nest by indent and keep a custom start", () => {
    expect(clipboardHtml("1. a\n2. b\n  1. b1\n  2. b2\n3. c")).toBe(
      "<ol>\n<li>a</li>\n<li>b\n<ol>\n<li>b1</li>\n<li>b2</li>\n</ol></li>\n<li>c</li>\n</ol>",
    );
    expect(clipboardHtml("5. e\n6. f")).toBe('<ol start="5">\n<li>e</li>\n<li>f</li>\n</ol>');
    expect(clipboardHtml("- x\n  - y\n- z")).toBe(
      "<ul>\n<li>x\n<ul>\n<li>y</li>\n</ul></li>\n<li>z</li>\n</ul>",
    );
  });
  test("headings, paragraphs, quotes, code fences, and rules render as blocks", () => {
    expect(clipboardHtml("# T\n\nsome **bold**\n> q\n```\nlet x = 1 < 2;\n```\n---")).toBe(
      "<h1>T</h1>\n<p>some <strong>bold</strong></p>\n<blockquote>\n<p>q</p>\n</blockquote>\n<pre><code>let x = 1 &lt; 2;</code></pre>\n<hr>",
    );
  });
  test("tasks keep a box glyph; images become <img> with data bytes when resolved", () => {
    const images = new Map([["storage:551.png", "data:image/png;base64,AAAA"]]);
    expect(
      clipboardHtml("- [ ] todo\n- [x] done\n![](storage:551.png)\n![](storage:missing.png)", images),
    ).toBe(
      '<ul>\n<li>☐ todo</li>\n<li>☑ done</li>\n</ul>\n<p><img src="data:image/png;base64,AAAA" alt="551.png"></p>\n<p><span data-image="storage:missing.png">[image: missing.png]</span></p>',
    );
  });
  test("the inline grammar matches Breve's fixture", () => {
    for (const c of fixture.cases) expect(inlineHtml(c.input)).toBe(c.html);
  });
  test("_x_ copies as <em>; intraword underscores stay text", () => {
    expect(inlineHtml("an _italic_ and snake_case_name")).toBe("an <em>italic</em> and snake_case_name");
  });
  test("html is escaped", () => {
    expect(clipboardHtml("a <b> & c")).toBe("<p>a &lt;b&gt; &amp; c</p>");
  });
});

test("imageSourcesIn lists each source once", () => {
  expect(imageSourcesIn("![](a.png)\n- ![](storage:b.png)\n![](a.png)")).toEqual(["a.png", "storage:b.png"]);
});
