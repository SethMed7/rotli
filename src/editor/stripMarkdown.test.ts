// stripMarkdown is what the editor puts on the clipboard in beautified mode —
// a copy should read like what you SEE, with no stray ** around bold.

import { describe, expect, test } from "bun:test";

import fixture from "../../scripts/fixtures/markdown-strip.json";
import { stripMarkdown } from "./stripMarkdown";

describe("stripMarkdown (beautified copy)", () => {
  test("drops inline bold/italic/code/highlight/strike/underline markers", () => {
    expect(stripMarkdown("a **bold** and *italic* and `code`")).toBe("a bold and italic and code");
    expect(stripMarkdown("==hi== ~~no~~ <u>u</u>")).toBe("hi no u");
  });
  test("links become their text", () => {
    expect(stripMarkdown("see [the docs](https://x.com)")).toBe("see the docs");
  });
  test("strips block prefixes per line (heading, bullet, task, numbered, quote)", () => {
    expect(stripMarkdown("# Title")).toBe("Title");
    expect(stripMarkdown("- item")).toBe("item");
    expect(stripMarkdown("  - nested **bold**")).toBe("  nested bold");
    expect(stripMarkdown("1. first")).toBe("first");
    expect(stripMarkdown("> quote")).toBe("quote");
    expect(stripMarkdown("- [ ] todo")).toBe("todo");
    expect(stripMarkdown("- [ ][x] failed\n2. [x][ ] passed")).toBe("failed\npassed");
    expect(stripMarkdown("- [True:green][x False:red] decision")).toBe("True / False decision");
    expect(stripMarkdown("- ( ) Red\n2. (x) Blue")).toBe("Red\nBlue");
    expect(stripMarkdown("- [#x] Red\n- [##] Email\n- [True|x False] Flag")).toBe("Red\nEmail\nFalse Flag");
  });
  test("a multi-line list copies clean", () => {
    expect(stripMarkdown("- **a**\n- b\n  - c")).toBe("a\nb\n  c");
  });
  test("plain text is untouched", () => {
    expect(stripMarkdown("just words")).toBe("just words");
    expect(stripMarkdown("- [##?] Question\n- [##X] Answer")).toBe("Question\nAnswer");
    expect(stripMarkdown("- [##?:center] Question")).toBe("Question");
    expect(stripMarkdown("`[##?]` literal")).toBe("[##?] literal");
  });
});

// The cross-boundary behavioral contract (remediation Batch 3): Breve's
// markdown-text.ts renders the SAME inline grammar to HTML and asserts the same
// fixture — behavior parity without sharing an implementation across the
// app/runtime boundary (MIRROR-NOT-IMPORT).
describe("markdown-strip.json fixture (Breve parity)", () => {
  for (const c of fixture.cases) {
    test(c.name, () => {
      expect(stripMarkdown(c.input)).toBe(c.text);
    });
  }
});

describe("stripMarkdown — links", () => {
  test("an empty-text link copies as its url; an image is not a link", () => {
    expect(stripMarkdown("see [](sethmedina.com)")).toBe("see sethmedina.com");
    expect(stripMarkdown("![](storage:a.png)")).toBe("![](storage:a.png)");
  });
});

describe("stripMarkdown — lettered lists", () => {
  test("plain copy drops a lettered marker; abbreviations stay", () => {
    expect(stripMarkdown("a. first\n  B. nested")).toBe("first\n  nested");
    expect(stripMarkdown("e.g. this")).toBe("e.g. this");
  });
});
