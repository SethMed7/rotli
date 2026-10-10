// The Markdown twin of a page written in Astro (site/src/markdownTwin.ts): /privacy/'s article
// read back into Markdown after the build, for Copy Markdown and `Accept: text/markdown`.
// e2e/site/privacy-page.spec.ts proves the built twin; this holds the conversion's rules. Like
// the other site tests, the module loads through a computed path so the site's types stay out of
// the root typecheck.
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

const site = (...parts: string[]) => join(import.meta.dir, "..", "site", "src", ...parts);

let twin: {
  decodeEntities(text: string): string;
  pageMarkdown(html: string, url: string): string;
};

beforeAll(async () => {
  twin = (await import(site("markdownTwin.ts"))) as typeof twin;
});

const page = (prose: string) =>
  `<!doctype html><html><head><title>x</title><script>if (a < b) document.write("<p>no</p>")</script></head>
  <body><header><h1>Privacy</h1><p class="lede">Nothing to collect.</p></header>
  <div class="prose" data-prose>${prose}</div><footer><p>Footer words</p></footer></body></html>`;

describe("a page's Markdown twin", () => {
  test("opens on the title and the lede, closes on where the page lives", () => {
    const md = twin.pageMarkdown(page("<p>Hello.</p>"), "https://rotli.co/privacy/");
    expect(md).toBe(
      "# Privacy\n\n> Nothing to collect.\n\nHello.\n\n---\n\nSource: https://rotli.co/privacy/\n",
    );
  });

  test("keeps headings, paragraphs, emphasis, code, and lists, and makes every link whole", () => {
    const md = twin.pageMarkdown(
      page(`<h2 id="a">Your notes</h2>
        <p><strong>Why:</strong> files are <em>yours</em>, in <code>.rotli</code>. See <a href="#keys">Keys</a> and <a href="/blog/why-local/">Why local</a>.</p>
        <ul><li><b>Updates.</b> Checks often.</li><li>Nested<ul><li>Inner</li></ul></li></ul>
        <ol><li>One</li><li>Two</li></ol>`),
      "https://rotli.co/privacy/",
    );
    expect(md).toContain("## Your notes");
    expect(md).toContain(
      "**Why:** files are *yours*, in `.rotli`. See [Keys](https://rotli.co/privacy/#keys) and [Why local](https://rotli.co/blog/why-local/).",
    );
    expect(md).toContain("- **Updates.** Checks often.\n- Nested\n  - Inner");
    expect(md).toContain("1. One\n2. Two");
  });

  test("turns a table into a table, its caption above, a header's small print in parentheses", () => {
    const md = twin.pageMarkdown(
      page(`<div class="wide"><table><caption>Who may read</caption>
        <thead><tr><th>Note</th><th>On-device model<small>runs on your Mac</small></th></tr></thead>
        <tbody><tr><th scope="row"><b>Secure note</b><small>Right-click</small></th><td>Reads it | maybe</td></tr></tbody>
        </table></div>`),
      "https://rotli.co/privacy/",
    );
    expect(md).toContain(
      "**Who may read**\n\n| Note | On-device model (runs on your Mac) |\n| --- | --- |\n| **Secure note** (Right-click) | Reads it \\| maybe |",
    );
  });

  test("leaves out decoration: hidden things, companions, images, drawings, buttons, scripts", () => {
    const md = twin.pageMarkdown(
      page(`<p>Kept.</p><img class="spot" alt="A quokka"><div class="spot"><p>Companion</p></div>
        <p aria-hidden="true">Hidden</p><svg><text>Drawing</text></svg><button>Copy</button><p hidden>Gone</p>`),
      "https://rotli.co/privacy/",
    );
    expect(md).toContain("Kept.");
    for (const word of ["quokka", "Companion", "Hidden", "Drawing", "Copy", "Gone", "Footer", "no</p>"])
      expect(md).not.toContain(word);
  });

  test("reads entities, and fails loudly when the page has no article", () => {
    expect(twin.decodeEntities("rotli&#39;s &amp; &#x2192; &rarr; &nbsp;")).toBe("rotli's & → &rarr;  ");
    expect(() => twin.pageMarkdown("<p>no article</p>", "https://rotli.co/x/")).toThrow(/data-prose/);
  });
});
