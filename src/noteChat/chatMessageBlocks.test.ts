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
});
