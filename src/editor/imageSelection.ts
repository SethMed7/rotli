import { IMAGE_EXTS, VIDEO_EXTS, extOf } from "../lib/fileKind";
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
  /** Obsidian's `![[name.png|width]]` form: a resize writes it back the same way. */
  wiki?: boolean;
}

const IMAGE_ONLY = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/;
// `![[photo.png]]` / `![[photo.png|420]]` — only image and video files; any
// other `![[file]]` is a file embed (a sheet, a document, a board), not a picture
const WIKI_IMAGE_ONLY = /^\s*!\[\[([^\]|#]+)(?:\|(\d+))?\]\]\s*$/;

/** The source span replaced by an image widget on this line. List markers stay
 * outside the span so arrow selection preserves the visible list structure. */
export function imageSourceSpan(lineText: string, lineFrom: number): ImageSourceSpan | null {
  const block = parseBlock(lineText);
  const prefixLen = ["bullet", "numbered", "task", "result", "choice"].includes(block.kind)
    ? block.prefixLen
    : 0;
  const content = lineText.slice(prefixLen);
  const wiki = WIKI_IMAGE_ONLY.exec(content);
  const target = wiki?.[1]?.trim() ?? "";
  if (wiki && (IMAGE_EXTS.has(extOf(target)) || VIDEO_EXTS.has(extOf(target)))) {
    const width = wiki[2] ? `|${wiki[2]}` : "";
    return {
      from: lineFrom + prefixLen,
      to: lineFrom + lineText.length,
      alt: width,
      src: target,
      wiki: true,
    };
  }
  const match = IMAGE_ONLY.exec(content);
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
