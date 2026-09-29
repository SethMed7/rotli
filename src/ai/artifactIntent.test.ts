import { describe, expect, test } from "bun:test";

import { artifactClarification } from "./artifactIntent";

describe("artifact format clarification", () => {
  test("asks instead of guessing whether a generic document means Word or Markdown", () => {
    expect(artifactClarification("Create a document about TanStack", { documentTool: true })).toEqual({
      kind: "question",
      prompt: "Before I create it, which format do you want?",
      options: ["Word document (.docx)", "Markdown note (.md)"],
    });
  });

  test("does not substitute a note when Word creation is unavailable in the current vault", () => {
    expect(artifactClarification("Create a Word doc about TanStack", { documentTool: false })).toEqual({
      kind: "final",
      text: "Editable Word document creation is unavailable in this chat’s current vault. I won’t substitute a Markdown note for it.",
    });
  });

  test("accepts Word documents with generated images when the native adapter is available", () => {
    expect(
      artifactClarification("Open up a Word doc and generate images to use in the doc", {
        documentTool: true,
      }),
    ).toBeNull();
  });

  test("an explicit separate-image plan and an ordinary Word request proceed", () => {
    expect(
      artifactClarification("Create a Word doc with image placement notes and separate images", {
        documentTool: true,
      }),
    ).toBeNull();
    expect(artifactClarification("Create a Word document about TanStack", { documentTool: true })).toBeNull();
    expect(artifactClarification("Explain TanStack in chat", { documentTool: true })).toBeNull();
  });
});

// 2026-09-29: "write me a new bio" plus a Google Docs link asked which format
// to use — the words "docs" and "document" were inside the URL, not the ask.
test("a document word inside a link is not a request for a document", () => {
  expect(
    artifactClarification(
      "Review this ebook - https://docs.google.com/document/d/abc/edit - and then write me a new bio",
      { documentTool: true },
    ),
  ).toBeNull();
});
