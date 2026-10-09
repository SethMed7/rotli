// What Tab does to each kind of line (owner request #10, 2026-10-02: "proper
// tab for like indenting in"). Lists nest without limit; a paragraph takes one
// level and stops short of CommonMark's four-space code block; a block Rotli
// would stop recognizing once indented stays put.

import { describe, expect, test } from "bun:test";

import {
  indentColumns,
  indentedPrefix,
  indentRoleOf,
  PARAGRAPH_INDENT_MAX,
  paragraphIndentLevels,
} from "./lineIndent";
import { paragraphIndentStyle, STEP_EM, MARKER_EM } from "./listGeometry";

describe("indentRoleOf", () => {
  test("list kinds, quotes, and empty lines nest", () => {
    for (const line of [
      "- a",
      "  - a",
      "1. a",
      "a. a",
      "- [ ] a",
      "- [x][ ] a",
      "- ( ) a",
      "> a",
      "",
      "  ",
    ]) {
      expect(indentRoleOf(line)).toBe("nests");
    }
  });

  test("prose, including a not-yet-table row, is a paragraph", () => {
    for (const line of ["text", "  text", "| a | b |", "**bold** start"]) {
      expect(indentRoleOf(line)).toBe("paragraph");
    }
  });

  test("headings, aligned paragraphs, dividers, and image lines stay put", () => {
    for (const line of [
      "# Title",
      "### Section",
      " # Near heading",
      "   ## Three deep",
      '<p align="center">hi</p>',
      "---",
      "![alt](storage:a.png)",
    ]) {
      expect(indentRoleOf(line)).toBe("fixed");
    }
  });
});

describe("indentedPrefix", () => {
  test("a list item gains one level per press, tabs normalized", () => {
    expect(indentedPrefix("- a")).toBe("  ");
    expect(indentedPrefix("    - a")).toBe("      ");
    expect(indentedPrefix("\t- a")).toBe("    ");
  });

  test("a paragraph reaches one level and no further — four spaces would be code", () => {
    expect(indentedPrefix("text")).toBe("  ");
    expect(indentedPrefix(" text")).toBe("  ");
    expect(indentedPrefix("  text")).toBeNull();
    expect(indentedPrefix("\ttext")).toBeNull();
    expect(PARAGRAPH_INDENT_MAX).toBeLessThan(4);
  });

  test("a heading never indents (it would become literal text)", () => {
    expect(indentedPrefix("## Heading")).toBeNull();
  });

  test("fenced code is the user's own indentation and always nests", () => {
    expect(indentedPrefix("    code", true)).toBe("      ");
    expect(indentedPrefix("# comment", true)).toBe("  ");
  });

  test("a heading one to three spaces deep stays put too", () => {
    expect(indentedPrefix(" # Title")).toBeNull();
    expect(indentRoleOf("    # four deep is code, not a heading")).toBe("paragraph");
  });

  test("a paragraph shows one level per two columns, and one space is still a level", () => {
    expect(paragraphIndentLevels("text")).toBe(0);
    expect(paragraphIndentLevels(" text")).toBe(1);
    expect(paragraphIndentLevels("  text")).toBe(1);
    expect(paragraphIndentLevels("     text")).toBe(2);
  });

  test("indentColumns counts a tab as one level", () => {
    expect(indentColumns("\t  x")).toBe(4);
    expect(indentColumns("x")).toBe(0);
  });
});

describe("paragraphIndentStyle", () => {
  test("one level puts the text on a top-level bullet's text column", () => {
    expect(paragraphIndentStyle(1)).toBe(`padding-left:${MARKER_EM}em`);
  });

  test("each further level is one list step", () => {
    expect(paragraphIndentStyle(2)).toBe(`padding-left:${STEP_EM + MARKER_EM}em`);
  });
});
