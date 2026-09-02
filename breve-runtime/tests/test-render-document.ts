import { describe, expect, test } from "bun:test";

import { PDF_THEME_PRESETS } from "../scripts/pdf-theme";
import { documentHtml, markdownToHtml, parseArgs, stripFrontmatter } from "../scripts/render-document";

describe("render-document markdown → HTML", () => {
  test("headings, lists, tasks, quotes, code, tables, and links all render", () => {
    const md = `---
id: 01J
title: Launch plan
---
# Launch plan

Ship **calmly** with [the notes](https://example.com/notes).

## Goals
- First goal
- [ ] open task
- [x] done task
- [/] half task
1. step one
2. step two

> A quiet quote

\`\`\`ts
const a = "<b>";
\`\`\`

| Col A | Col B |
| --- | --- |
| 1 | 2 |

---
Tail paragraph.`;
    const html = markdownToHtml(md, "Launch plan");
    expect(html).not.toContain("id: 01J"); // frontmatter dropped
    expect(html).not.toContain("<h1>"); // the H1 that repeats the title is the masthead
    expect(html).toContain("<h2>Goals</h2>");
    expect(html).toContain("<strong>calmly</strong>");
    expect(html).toContain('<a href="https://example.com/notes">the notes</a>');
    expect(html).toContain("<li>First goal</li>");
    expect(html).toContain('<li><span class="box">☐</span> open task</li>');
    expect(html).toContain('<li class="task done"><span class="box">☑</span> done task</li>');
    expect(html).toContain('<li class="task half"><span class="box">◪</span> half task</li>');
    expect(html).toContain("<ol><li>step one</li><li>step two</li></ol>");
    expect(html).toContain("<blockquote><p>A quiet quote</p></blockquote>");
    expect(html).toContain('<pre><code>const a = &quot;&lt;b&gt;&quot;;</code></pre>'.replace(/&quot;/g, '"'));
    expect(html).toContain("<thead><tr><th>Col A</th><th>Col B</th></tr></thead>");
    expect(html).toContain("<tr><td>1</td><td>2</td></tr>");
    expect(html).toContain("<hr>");
    expect(html).toContain("<p>Tail paragraph.</p>");
  });

  test("a different H1 is kept and raw HTML is escaped", () => {
    const html = markdownToHtml("# Other title\n\n<script>x</script>", "Launch plan");
    expect(html).toContain("<h1>Other title</h1>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });

  test("the page carries the palette, the title, and no Breve masthead", () => {
    const html = documentHtml("Notes & plans", "Body", PDF_THEME_PRESETS.paper, "September 2, 2026");
    expect(html).toContain("--bg:#fafaf9");
    expect(html).toContain("<title>Notes &amp; plans</title>");
    expect(html).toContain("print-color-adjust: exact");
    expect(html).not.toContain("BREVE");
    expect(html).toContain("exported from Rotli");
  });
});

describe("render-document arguments", () => {
  test("requires --in and --out; --title is optional", () => {
    expect(parseArgs(["--in", "a.md", "--out", "a.pdf", "--title", "A"])).toEqual({
      input: "a.md",
      output: "a.pdf",
      title: "A",
    });
    expect(parseArgs(["--in", "a.md", "--out", "a.pdf"]).title).toBe("");
    expect(() => parseArgs(["--in", "a.md"])).toThrow("--out");
  });

  test("stripFrontmatter only removes a leading block", () => {
    expect(stripFrontmatter("---\na: 1\n---\nBody")).toBe("Body");
    expect(stripFrontmatter("Body\n---\nnot frontmatter")).toBe("Body\n---\nnot frontmatter");
  });
});
