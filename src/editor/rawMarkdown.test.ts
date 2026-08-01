import { describe, expect, test } from "bun:test";

import { Text } from "@codemirror/state";

import { classifyRawMarkdown } from "./rawMarkdownSyntax";

function slices(source: string, className: string): string[] {
  const doc = Text.of(source.split("\n"));
  return classifyRawMarkdown(doc)
    .tokens.filter((token) => token.className === className)
    .map((token) => doc.sliceString(token.from, token.to));
}

describe("raw Markdown syntax theme", () => {
  test("separates Rotli punctuation from blue semantic structure", () => {
    const source = "# Model landscape\n- **Inkling** links to [[Strategy]]";
    expect(slices(source, "rotli-raw-heading")).toEqual([" Model landscape"]);
    expect(slices(source, "rotli-raw-strong")).toEqual(["**Inkling**"]);
    expect(slices(source, "rotli-raw-accent")).toEqual(["#", "-", "[[Strategy]]"]);
  });

  test("treats fenced bodies as code instead of Markdown", () => {
    const source = "```mermaid\nflowchart LR\n  A[**not bold**] --> B\n```";
    const classified = classifyRawMarkdown(Text.of(source.split("\n")));
    expect(classified.lines.map((line) => line.className)).toEqual([
      "rotli-raw-code-line",
      "rotli-raw-code-line",
      "rotli-raw-code-line",
      "rotli-raw-code-line",
    ]);
    expect(slices(source, "rotli-raw-strong")).toEqual([]);
    expect(slices(source, "rotli-raw-code-text")).toEqual(["flowchart LR", "  A[**not bold**] --> B"]);
  });

  test("styles table delimiters quietly and keeps cell pipes structural", () => {
    const source = "| Model | License |\n| ----- | ------- |\n| Inkling | Apache |";
    expect(slices(source, "rotli-raw-muted")).toEqual(["| ----- | ------- |"]);
    expect(slices(source, "rotli-raw-accent")).toEqual(["|", "|", "|", "|", "|", "|"]);
  });
});
