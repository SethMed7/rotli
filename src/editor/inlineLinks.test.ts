// The one link grammar: autolinks (http(s), www., email, and bare domains on
// an allowlisted TLD), `[text](url)` with optional text, and the href normalizer that
// turns what was typed into what opens.

import { describe, expect, test } from "bun:test";

import { AUTOLINK_SOURCE, linkHref, linkLabel, linkMatchAt, MD_LINK_SOURCE } from "./inlineLinks";

const autolinks = (text: string) => [...text.matchAll(new RegExp(AUTOLINK_SOURCE, "g"))].map((m) => m[0]);
const mdLink = (text: string) => new RegExp(MD_LINK_SOURCE).exec(text)?.slice(1, 3) ?? null;

describe("autolinks", () => {
  test("http(s) urls, www. hosts, and emails link; trailing punctuation stays prose", () => {
    expect(autolinks("see https://x.com/a).")).toEqual(["https://x.com/a"]);
    expect(autolinks("www.x.com")).toEqual(["www.x.com"]);
    expect(autolinks("go to www.x.com/docs?q=1, then")).toEqual(["www.x.com/docs?q=1"]);
    expect(autolinks("a@b.co")).toEqual(["a@b.co"]);
    expect(autolinks("mail first.last+tag@mail.b.co.")).toEqual(["first.last+tag@mail.b.co"]);
  });

  test("bare domains on a known TLD link, with an optional path; a closing period stays prose", () => {
    expect(autolinks("sethmedina.com")).toEqual(["sethmedina.com"]);
    expect(autolinks("try rotli.co today")).toEqual(["rotli.co"]);
    expect(autolinks("github.com/SethMed7/rotli")).toEqual(["github.com/SethMed7/rotli"]);
    expect(autolinks("docs.example.io/path?x=1")).toEqual(["docs.example.io/path?x=1"]);
    expect(autolinks("see sethmedina.com.")).toEqual(["sethmedina.com"]);
    expect(autolinks("(bbc.co.uk), then")).toEqual(["bbc.co.uk"]);
    expect(autolinks("github.com/a_b_c")).toEqual(["github.com/a_b_c"]);
  });

  test("file names, versions, numbers, and abbreviations are prose", () => {
    for (const prose of [
      "node.js",
      "file.md",
      "notes.txt",
      "index.ts",
      "install.sh",
      "libfoo.so",
      "Rotli.app",
      "etc.",
      "e.g. this",
      "v0.95.1",
      "3.14",
      "a.b",
      "v1.2.3",
      "@handle",
      "@rotli.co",
      "~/site.com",
      "foo.com.zz",
      "sethmedina.company",
    ]) {
      expect(autolinks(prose)).toEqual([]);
    }
  });

  test("an email stays one email, never an email plus a bare domain", () => {
    expect(autolinks("foo@bar.com")).toEqual(["foo@bar.com"]);
  });

  test("www. hosts, domains, and emails need a word boundary on the left (never a partial host)", () => {
    expect(autolinks("foo.www.x.com")).toEqual(["foo.www.x.com"]);
    expect(autolinks("foo_www.x.com")).toEqual([]);
    expect(autolinks("x@www.y.com")).toEqual(["x@www.y.com"]);
    expect(autolinks("https://user@host.com")).toEqual(["https://user@host.com"]);
  });
});

describe("[text](url)", () => {
  test("text may be empty; `[]()` and images are not links", () => {
    expect(mdLink("[docs](https://x.com)")).toEqual(["docs", "https://x.com"]);
    expect(mdLink("[](x.com)")).toEqual(["", "x.com"]);
    expect(mdLink("[]()")).toBeNull();
    expect(mdLink("![alt](storage:a.png)")).toBeNull();
    expect(linkLabel("", "x.com")).toBe("x.com");
    expect(linkLabel("docs", "x.com")).toBe("docs");
  });

  test("linkMatchAt finds the link under a column, inclusive of its ends", () => {
    const line = "a [one](x.com) b [two](y.com)";
    expect(linkMatchAt(MD_LINK_SOURCE, line, 2)?.[1]).toBe("one");
    expect(linkMatchAt(MD_LINK_SOURCE, line, 20)?.[1]).toBe("two");
    expect(linkMatchAt(MD_LINK_SOURCE, line, 15)).toBeNull();
  });
});

describe("linkHref", () => {
  test("scheme-less web addresses gain https://; emails become mailto:", () => {
    expect(linkHref("sethmedina.com")).toBe("https://sethmedina.com/");
    expect(linkHref("www.x.com")).toBe("https://www.x.com/");
    expect(linkHref("http://x.com/a")).toBe("http://x.com/a");
    expect(linkHref("a@b.co")).toBe("mailto:a@b.co");
    expect(linkHref("mailto:a@b.co")).toBe("mailto:a@b.co");
  });

  test("anything that names no web address opens nothing", () => {
    for (const bad of [
      "",
      "  ",
      "#heading",
      "notes/file.md",
      "./file.md",
      "javascript:alert(1)",
      "ftp://x.com",
      "localhost:3000",
      "mailto:nobody",
    ]) {
      expect(linkHref(bad)).toBeNull();
    }
  });
});
