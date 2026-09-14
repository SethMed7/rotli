// Static readers (Quick Look peek) render links from the same grammar as the
// editor: an empty-text link shows its url, scheme-less addresses open as
// https, emails as mailto, and an unopenable link keeps a failing href.

import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { renderInline } from "./render";

const html = (text: string) => renderToStaticMarkup(<>{renderInline(text)}</>);

test("[](url) renders the url as the link text with a normalized href", () => {
  expect(html("[](sethmedina.com)")).toBe(
    '<a class="md-link" href="https://sethmedina.com/" title="sethmedina.com">sethmedina.com</a>',
  );
});

test("an empty-text link to a full address is one anchor, never a nested autolink", () => {
  for (const address of ["https://x.com", "www.x.com", "a@b.co"]) {
    expect(html(`[](${address})`).split("<a ").length - 1).toBe(1);
  }
});

test("www. hosts, emails, and bare domains autolink; file names stay prose", () => {
  expect(html("www.x.com")).toBe(
    '<a class="md-link" href="https://www.x.com/" title="www.x.com">www.x.com</a>',
  );
  expect(html("a@b.co")).toBe('<a class="md-link" href="mailto:a@b.co" title="a@b.co">a@b.co</a>');
  expect(html("node.js and sethmedina.com.")).toBe(
    'node.js and <a class="md-link" href="https://sethmedina.com/" title="sethmedina.com">sethmedina.com</a>.',
  );
});

test("_x_ is italic; intraword and dunder underscores stay prose", () => {
  expect(html("an _italic_ word")).toBe("an <em>italic</em> word");
  expect(html("(_a_) **_both_**")).toBe("(<em>a</em>) <strong><em>both</em></strong>");
  for (const prose of ["snake_case_name", "file_name.md", "__init__", "_ spaced _", "a_b_"]) {
    expect(html(prose)).toBe(prose);
  }
});

test("a bare link containing underscores stays one link, never italic", () => {
  expect(html("github.com/a_b_c")).toBe(
    '<a class="md-link" href="https://github.com/a_b_c" title="github.com/a_b_c">github.com/a_b_c</a>',
  );
  expect(html("_see https://x.com/a_ b")).not.toContain("<em>");
});

test("a link to no web address keeps its text and a # href", () => {
  expect(html("[notes](notes/file.md)")).toBe('<a class="md-link" href="#" title="notes/file.md">notes</a>');
});

test("bold-italic renders both marks and still nests an underline", () => {
  expect(html("***<u>x</u>***")).toBe("<strong><em><u>x</u></em></strong>");
});
