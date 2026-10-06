// What Tab does to one line (SYNTAX.md, "Tab indents"). One level is two
// spaces — the list grammar's unit — and every line kind answers differently:
//   • a list item, quote, or empty line nests one level per press, no limit;
//   • a paragraph line takes ONE level and stops: CommonMark strips up to three
//     leading spaces (Rotli shows them as a visible indent) but reads four as an
//     indented code block, so a second level would turn prose into code
//     everywhere else the file is opened;
//   • a heading, aligned paragraph, divider, or image line stays put — leading
//     spaces would make Rotli read it as plain text, which is not an indent.
// Pure (no view), so the keymap and its tests share it.

import { parseAlignedLine } from "./alignedLine";
import { imageSourceSpan } from "./imageSelection";
import { parseBlock } from "./render";

/** One indent level in source. */
export const INDENT_UNIT = "  ";

/** The deepest leading indent, in columns, Tab gives a paragraph line. */
export const PARAGRAPH_INDENT_MAX = 2;

/** A thematic break (`---`, `***`, `___`, up to three leading spaces).
 * Frontmatter never reaches the editor's body, and table delimiter rows carry
 * pipes, so neither matches. */
export const DIVIDER_LINE = /^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/;

/** An ATX heading written one to three spaces deep. CommonMark still reads it
 * as a heading, so Tab leaves it alone rather than deepening it into prose. */
const NEAR_HEADING = /^ {1,3}#{1,6}(\s|$)/;

export type IndentRole = "nests" | "paragraph" | "fixed";

/** How Tab treats a line outside fenced code. */
export function indentRoleOf(text: string): IndentRole {
  if (text.trim() === "") return "nests";
  const kind = parseBlock(text).kind;
  if (kind !== "para") return /^h\d$/.test(kind) ? "fixed" : "nests";
  if (
    NEAR_HEADING.test(text) ||
    parseAlignedLine(text) ||
    DIVIDER_LINE.test(text) ||
    imageSourceSpan(text, 0)
  )
    return "fixed";
  return "paragraph";
}

/** A line's leading indent, tab-tolerant. */
export const leadingIndent = (text: string): string => /^[ \t]*/.exec(text)?.[0] ?? "";

/** Columns of leading indent, a tab counting one level. */
export const indentColumns = (text: string): number => leadingIndent(text).replace(/\t/g, INDENT_UNIT).length;

/** The indent levels live preview draws for a paragraph line: one per two
 * columns, and a lone leading space still reads as one level rather than flush. */
export function paragraphIndentLevels(text: string): number {
  const columns = indentColumns(text);
  return columns === 0 ? 0 : Math.max(1, Math.floor(columns / 2));
}

/** The new leading indent after one Tab (tabs normalized to the two-space
 * grammar), or null when Tab leaves the line as it is. Fenced code is the
 * user's own indentation and always nests. */
export function indentedPrefix(text: string, inFence = false): string | null {
  const role = inFence ? "nests" : indentRoleOf(text);
  if (role === "fixed") return null;
  if (role === "paragraph") {
    return indentColumns(text) < PARAGRAPH_INDENT_MAX ? " ".repeat(PARAGRAPH_INDENT_MAX) : null;
  }
  return `${INDENT_UNIT}${leadingIndent(text).replace(/\t/g, INDENT_UNIT)}`;
}
