import { describe, expect, test } from "bun:test";

import { documentDraftFromMarkdown } from "./fromMarkdown";

describe("Word document creation content", () => {
  test("maps headings, prose, lists, and a GFM table into the document draft", () => {
    expect(
      documentDraftFromMarkdown(
        "TanStack guide",
        [
          "# TanStack guide",
          "## Why it works",
          "**Headless** tools separate logic from presentation.",
          "- Query",
          "1. Router",
          "| Tool | Purpose |",
          "| --- | --- |",
          "| Query | Server state |",
        ].join("\n"),
      ),
    ).toEqual({
      title: "TanStack guide",
      content: [
        {
          kind: "paragraph",
          paragraph: { namedStyle: "heading2", runs: [{ text: "Why it works" }] },
        },
        {
          kind: "paragraph",
          paragraph: { runs: [{ text: "Headless tools separate logic from presentation." }] },
        },
        {
          kind: "paragraph",
          paragraph: { list: "bullet", runs: [{ text: "Query" }] },
        },
        {
          kind: "paragraph",
          paragraph: { list: "number", runs: [{ text: "Router" }] },
        },
        {
          kind: "table",
          table: {
            id: "table-1",
            rows: [
              {
                cells: [
                  { paragraphs: [{ runs: [{ text: "Tool" }] }] },
                  { paragraphs: [{ runs: [{ text: "Purpose" }] }] },
                ],
              },
              {
                cells: [
                  { paragraphs: [{ runs: [{ text: "Query" }] }] },
                  { paragraphs: [{ runs: [{ text: "Server state" }] }] },
                ],
              },
            ],
          },
        },
      ],
    });
  });

  test("does not duplicate the first model-authored H1 and joins wrapped prose", () => {
    expect(
      documentDraftFromMarkdown(
        "Architecture Deep Dive",
        "# TanStack: Architecture Deep Dive\n\nFirst line of one paragraph\ncontinues here.\n\n## Next",
      ),
    ).toEqual({
      title: "Architecture Deep Dive",
      content: [
        {
          kind: "paragraph",
          paragraph: { runs: [{ text: "First line of one paragraph continues here." }] },
        },
        {
          kind: "paragraph",
          paragraph: { namedStyle: "heading2", runs: [{ text: "Next" }] },
        },
      ],
    });
  });

  test("retains an image link as a placement note when no image bytes are supplied", () => {
    expect(documentDraftFromMarkdown("Guide", "![Architecture](storage:chats/x/img.png)")).toEqual({
      title: "Guide",
      content: [
        {
          kind: "paragraph",
          paragraph: {
            runs: [{ text: "[Image placement: Architecture — storage:chats/x/img.png]" }],
          },
        },
      ],
    });
  });
});
