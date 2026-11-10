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
const OPENING = /^﻿?---\r?\n/;

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

/** Does the file's first block mark it `key: true`? For protection marks:
 * an opening fence that never closes can't prove the mark absent, so it
 * counts as marked (fails closed). */
export function protectionMark(contents: string, key: string): boolean {
  const block = frontmatterBlock(contents);
  if (!block) return OPENING.test(contents);
  return new RegExp(`^${key}:\\s*true\\s*$`, "m").test(block.inner);
}
