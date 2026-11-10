// The first frontmatter block of a file: the one parser every reader and
// writer of a chat file's marks (and other line-level frontmatter facts)
// shares. A file saved by another editor with Windows line endings (CRLF) used
// to lose its `secureContext: true` mark on reopen, and could not be marked
// at all, because each reader matched "---\n" itself (sixth review of pull
// request 267, F5). scripts/check-owners.mjs refuses a new hand-written
// frontmatter match outside this file and the note codec (lib/frontmatter.ts).
//
// Pure: no host, no vault, no services.

export interface FrontmatterBlock {
  /** The block's lines, without carriage returns, joined with "\n". */
  inner: string;
  /** The newline the file uses, kept when the block is written back. */
  newline: "\n" | "\r\n";
  /** Where the block starts (its opening fence, after any byte-order mark)
   * and ends (just after its closing fence). */
  start: number;
  end: number;
}

const BLOCK = /^(﻿?)---(\r?\n)([\s\S]*?)\r?\n---/;

/** The file's first frontmatter block, or null when it has none. */
export function frontmatterBlock(contents: string): FrontmatterBlock | null {
  const match = BLOCK.exec(contents);
  if (!match) return null;
  return {
    inner: (match[3] ?? "").replace(/\r\n/g, "\n"),
    newline: match[2] === "\r\n" ? "\r\n" : "\n",
    start: match.index + (match[1]?.length ?? 0),
    end: match.index + match[0].length,
  };
}

/** `contents` with its first block's text replaced by `inner`, written with
 * the file's own newline. Everything outside the block is kept byte for byte. */
export function withFrontmatterBlock(contents: string, block: FrontmatterBlock, inner: string): string {
  const nl = block.newline;
  return `${contents.slice(0, block.start)}---${nl}${inner.split("\n").join(nl)}${nl}---${contents.slice(block.end)}`;
}

/** The body after the first block (and the newline that ends its fence), or
 * the whole file when it has none. */
export function afterFrontmatter(contents: string): string {
  const block = frontmatterBlock(contents);
  return block ? contents.slice(block.end).replace(/^\r?\n/, "") : contents;
}

/** Does the file carry `key` as a protection mark? The one grammar Rust
 * shares (src-tauri/src/protection_mark.rs), written out with every case in
 * scripts/fixtures/protection-marks.json; where it can't be sure, it says
 * marked (seventh review of pull request 267: the two sides disagreed on a
 * byte-order mark, an unclosed block, `key : true`, an indented key, TRUE). */
export function protectionMark(contents: string, key: string): boolean {
  const lines = contents
    .replace(/^\uFEFF/, "")
    .split("\n")
    .map((line) => line.replace(/\r$/, ""));
  let at = 0;
  while (at < lines.length && !lines[at]!.trim()) at += 1;
  if (at >= lines.length || lines[at]!.trimEnd() !== "---") return false;
  let found = false;
  for (const line of lines.slice(at + 1)) {
    if (line.trimEnd() === "---") return found;
    const colon = line.indexOf(":");
    if (colon < 0 || line.slice(0, colon).trim() !== key) continue;
    const value = line
      .slice(colon + 1)
      .trim()
      .replace(/^(["'])(.*)\1$/, "$2")
      .toLowerCase();
    if (!["false", "no", "off"].includes(value)) found = true;
  }
  return true; // a block that never closes can't show the mark absent
}
