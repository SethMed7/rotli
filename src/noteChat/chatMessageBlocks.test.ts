// The chat message splitter (generative UI, 2026-08-03): tables and mermaid
// render as real structures in the thread; everything unrecognized falls
// through as plain lines — a malformed block must never eat prose.

import { describe, expect, test } from "bun:test";

import { splitMessageBlocks, structureMessageLines } from "./chatMessageBlocks";

describe("splitMessageBlocks", () => {
  test("plain prose is one lines block; fences split around it", () => {
    const blocks = splitMessageBlocks("hello\n\n```ts\nconst x = 1;\n```\nafter");
    expect(blocks).toEqual([
      { kind: "lines", lines: ["hello", ""] },
      { kind: "code", lang: "ts", code: "const x = 1;" },
      { kind: "lines", lines: ["after"] },
    ]);
  });

  test("a mermaid fence becomes its own kind; other fences stay code", () => {
    const blocks = splitMessageBlocks("```mermaid\nflowchart TD\n  A --> B\n```");
    expect(blocks).toEqual([{ kind: "mermaid", code: "flowchart TD\n  A --> B" }]);
    expect(splitMessageBlocks("```python\nprint(1)\n```")[0]?.kind).toBe("code");
  });

  test("an unclosed fence (streaming) runs to the end without crashing", () => {
    const blocks = splitMessageBlocks("```mermaid\nflowchart TD\n  A --> B");
    expect(blocks).toEqual([{ kind: "mermaid", code: "flowchart TD\n  A --> B" }]);
  });

  test("a GFM table parses header, delimiter, and rows; ragged rows normalize", () => {
    const blocks = splitMessageBlocks(
      [
        "intro",
        "| Env | Key |",
        "| --- | :---: |",
        "| dev | k1 |",
        "| prod | k2 | extra |",
        "| short |",
        "tail",
      ].join("\n"),
    );
    expect(blocks).toEqual([
      { kind: "lines", lines: ["intro"] },
      {
        kind: "table",
        header: ["Env", "Key"],
        rows: [
          ["dev", "k1"],
          ["prod", "k2"],
          ["short", ""],
        ],
      },
      { kind: "lines", lines: ["tail"] },
    ]);
  });

  test("a pipe line WITHOUT a delimiter row stays prose (never a phantom table)", () => {
    expect(splitMessageBlocks("| just | prose |\nnot a delimiter")).toEqual([
      { kind: "lines", lines: ["| just | prose |", "not a delimiter"] },
    ]);
  });

  test("pipes inside a fence never start a table", () => {
    const blocks = splitMessageBlocks("```\n| a | b |\n| - | - |\n```");
    expect(blocks).toEqual([{ kind: "code", lang: "", code: "| a | b |\n| - | - |" }]);
  });
});

describe("structureMessageLines", () => {
  test("keeps headings, paragraphs, quotes, and list depth semantic", () => {
    expect(
      structureMessageLines([
        "## What changed",
        "A short explanation.",
        "",
        "- First",
        "  - Nested",
        "1. One",
        "   2. Two",
        "> A caution",
      ]),
    ).toEqual([
      { kind: "heading", level: 2, text: "What changed" },
      { kind: "paragraph", text: "A short explanation." },
      { kind: "space" },
      {
        kind: "list",
        ordered: false,
        items: [
          { depth: 0, text: "First" },
          { depth: 1, text: "Nested" },
        ],
      },
      {
        kind: "list",
        ordered: true,
        items: [
          { depth: 0, text: "One" },
          { depth: 1, text: "Two" },
        ],
      },
      { kind: "quote", text: "A caution" },
    ]);
  });

  test("recognizes provider progress plans without changing transcript text", () => {
    expect(
      structureMessageLines([
        "- [x] Read the contract",
        "- [~] Implement the native boundary",
        "- [ ] Run validation",
        "☑ Preserve the vault",
        "◉ Verify the current step",
        "☐ Publish only when asked",
      ]),
    ).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [
          { depth: 0, text: "Read the contract", taskState: "done" },
          { depth: 0, text: "Implement the native boundary", taskState: "active" },
          { depth: 0, text: "Run validation", taskState: "pending" },
          { depth: 0, text: "Preserve the vault", taskState: "done" },
          { depth: 0, text: "Verify the current step", taskState: "active" },
          { depth: 0, text: "Publish only when asked", taskState: "pending" },
        ],
      },
    ]);
  });

  // 2026-09-27 (Chat as a work surface, step 1): a reply line that is only an
  // image-style link to a vault file shows the file — an image, or a video.
  // Only `storage:` files: a remote address would load from outside the Mac.
  test("a line that is only an image link to a vault file is a media block", () => {
    expect(splitMessageBlocks("Here it is:\n![Launch clip](storage:chats/demo/clip.mp4)\nEnjoy.")).toEqual([
      { kind: "lines", lines: ["Here it is:"] },
      { kind: "media", alt: "Launch clip", path: "chats/demo/clip.mp4" },
      { kind: "lines", lines: ["Enjoy."] },
    ]);
    expect(splitMessageBlocks("  ![](storage:chart%20one.png)  ")).toEqual([
      { kind: "media", alt: "", path: "chart one.png" },
    ]);
  });

  test("remote images, inline images, and fenced ones stay text", () => {
    for (const text of [
      "![tracker](https://example.com/pixel.png)",
      "see ![chart](storage:chart.png) inline",
      "```md\n![chart](storage:chart.png)\n```",
      // a vault link that isn't a picture or a video keeps its Markdown
      "![plan](storage:wiki/plan.md)",
      "![logo](storage:brand/logo.svg)",
      "![report](storage:report.pdf)",
    ]) {
      expect(splitMessageBlocks(text).some((block) => block.kind === "media")).toBe(false);
    }
  });
});
