import { parseBlock } from "./render";

export interface TextSelection {
  from: number;
  to: number;
}

export interface ImageSourceSpan {
  from: number;
  to: number;
  alt: string;
  src: string;
}

const IMAGE_ONLY = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/;

/** The source span replaced by an image widget on this line. List markers stay
 * outside the span so arrow selection preserves the visible list structure. */
export function imageSourceSpan(lineText: string, lineFrom: number): ImageSourceSpan | null {
  const block = parseBlock(lineText);
  const prefixLen = ["bullet", "numbered", "task", "result", "choice"].includes(block.kind)
    ? block.prefixLen
    : 0;
  const match = IMAGE_ONLY.exec(lineText.slice(prefixLen));
  if (!match) return null;
  return {
    from: lineFrom + prefixLen,
    to: lineFrom + lineText.length,
    alt: match[1] ?? "",
    src: match[2] ?? "",
  };
}

/** True when a non-empty selection contains the complete image source span. */
export function selectionCoversImage(selection: TextSelection, from: number, to: number): boolean {
  return selection.from < selection.to && selection.from <= from && selection.to >= to;
}
