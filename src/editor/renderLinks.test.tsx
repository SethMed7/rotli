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

test("www. hosts and emails autolink; bare domains stay prose", () => {
  expect(html("www.x.com")).toBe(
    '<a class="md-link" href="https://www.x.com/" title="www.x.com">www.x.com</a>',
  );
  expect(html("a@b.co")).toBe('<a class="md-link" href="mailto:a@b.co" title="a@b.co">a@b.co</a>');
  expect(html("node.js and sethmedina.com")).toBe("node.js and sethmedina.com");
});

test("a link to no web address keeps its text and a # href", () => {
  expect(html("[notes](notes/file.md)")).toBe('<a class="md-link" href="#" title="notes/file.md">notes</a>');
});
