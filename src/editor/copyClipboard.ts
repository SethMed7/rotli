// A true copy. The clipboard gets two readings of the selection:
//   text/plain — what you SEE, structure kept: "1. Sale", "- item", "☐ task",
//                headings as their text, inline markers stripped, an image as
//                its name in brackets. Pasting into an AI chat or a terminal
//                keeps the numbers (before this the numbers vanished — Seth,
//                2026-09-03).
//   text/html  — real <ol>/<ul>/<li> nesting, headings, quotes, code, inline
//                marks, and <img src="data:…"> so Google Docs, Notes, and
//                mail paste the list AND the picture.
// Pure: no DOM, no CodeMirror. The inline HTML grammar mirrors Breve's
// markdown-text.ts through scripts/fixtures/markdown-strip.json
// (MIRROR-NOT-IMPORT across the app/runtime boundary).

import { imageSourceSpan } from "./imageSelection";
import { type Block, parseBlock } from "./render";
import { stripMarkdown } from "./stripMarkdown";

/** Resolved image bytes by source; an unresolved image copies as its name. */
export type ImageDataUrls = ReadonlyMap<string, string>;

const TASK_GLYPH: Record<string, string> = { open: "☐", done: "☑", progress: "◧" };

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Inline markdown → HTML (bold, italic, code, links, highlight, strike, underline). */
export function inlineHtml(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/==([^=]+)==/g, "<mark>$1</mark>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/&lt;(\/?)u&gt;/g, "<$1u>")
    .replace(/(^|[^*\w])\*([^*\s](?:[^*]*[^*\s])?)\*(?=$|[^*\w])/g, "$1<em>$2</em>");
}

function imageName(src: string): string {
  const base =
    src
      .replace(/^storage:/i, "")
      .split("/")
      .pop() ?? src;
  return base.split("?")[0] ?? base;
}

/** The plain reading: structure kept, markers made readable. */
export function clipboardText(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => {
      const image = imageSourceSpan(line, 0);
      const block = parseBlock(line);
      const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
      if (image) {
        const prefix = line.slice(0, image.from);
        return `${clipboardText(prefix)}[image: ${image.alt || imageName(image.src)}]`;
      }
      switch (block.kind) {
        case "numbered":
          return `${indent}${block.marker ?? "1."} ${stripMarkdown(block.text)}`;
        case "bullet":
          return `${indent}- ${stripMarkdown(block.text)}`;
        case "task": {
          const glyph = TASK_GLYPH[block.state ?? "open"] ?? "☐";
          const num = block.marker ? `${block.marker} ` : "";
          return `${indent}${num}${glyph} ${stripMarkdown(block.text)}`;
        }
        case "choice":
          return `${indent}${block.marker ? `${block.marker} ` : ""}${block.choiceSelected ? "◉" : "○"} ${stripMarkdown(block.text)}`;
        default:
          return stripMarkdown(line);
      }
    })
    .join("\n");
}

interface ListFrame {
  tag: "ol" | "ul";
  indent: number;
  open: boolean; // an <li> is open and may take a nested list
}

/** The rich reading: block structure as HTML, lists nested by indent. */
export function clipboardHtml(markdown: string, images: ImageDataUrls = new Map()): string {
  const out: string[] = [];
  const stack: ListFrame[] = [];
  let fence: string | null = null;
  let fenceLines: string[] = [];
  let quote = false;

  const closeLi = (frame: ListFrame) => {
    if (frame.open) out[out.length - 1] += "</li>";
    frame.open = false;
  };
  const closeLists = (toIndent: number) => {
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= toIndent) {
      const frame = stack.pop()!;
      closeLi(frame);
      out.push(`</${frame.tag}>`);
    }
  };
  const closeQuote = () => {
    if (quote) out.push("</blockquote>");
    quote = false;
  };
  const listItem = (tag: "ol" | "ul", indent: number, inner: string, start?: number) => {
    closeQuote();
    closeLists(indent + 1); // a shallower item ends every deeper list first
    const top = stack[stack.length - 1];
    if (top && top.indent === indent && top.tag === tag) {
      closeLi(top);
    } else {
      // a deeper item nests inside the open item; a different kind or a
      // shallower level opens a fresh list
      if (!(top && top.indent < indent)) closeLists(indent);
      out.push(`<${tag}${start && start > 1 ? ` start="${start}"` : ""}>`);
      stack.push({ tag, indent, open: false });
    }
    out.push(`<li>${inner}`);
    stack[stack.length - 1]!.open = true;
  };
  const imageHtml = (alt: string, src: string): string => {
    const data = images.get(src);
    const name = alt || imageName(src);
    return data
      ? `<img src="${escapeHtml(data)}" alt="${escapeHtml(name)}">`
      : `<span data-image="${escapeHtml(src)}">[image: ${escapeHtml(name)}]</span>`;
  };

  for (const raw of markdown.split("\n")) {
    if (fence !== null) {
      if (raw.trim().startsWith("```")) {
        out.push(`<pre><code>${escapeHtml(fenceLines.join("\n"))}</code></pre>`);
        fence = null;
        fenceLines = [];
      } else fenceLines.push(raw);
      continue;
    }
    if (raw.trim().startsWith("```")) {
      closeLists(0);
      closeQuote();
      fence = raw.trim().slice(3);
      continue;
    }
    const block: Block = parseBlock(raw);
    const indent = block.indent ?? 0;
    const image = imageSourceSpan(raw, 0);
    const body = image ? imageHtml(image.alt, image.src) : inlineHtml(block.text);
    switch (block.kind) {
      case "blank":
        closeLists(0);
        closeQuote();
        break;
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        closeLists(0);
        closeQuote();
        out.push(`<${block.kind}>${inlineHtml(block.text)}</${block.kind}>`);
        break;
      case "numbered":
        listItem("ol", indent, body, Number(block.marker?.replace(".", "") ?? 1));
        break;
      case "bullet":
        listItem("ul", indent, body);
        break;
      case "task": {
        const glyph = TASK_GLYPH[block.state ?? "open"] ?? "☐";
        listItem(
          block.marker ? "ol" : "ul",
          indent,
          `${glyph} ${body}`,
          Number(block.marker?.replace(".", "") ?? 1),
        );
        break;
      }
      case "choice":
        listItem(block.marker ? "ol" : "ul", indent, `${block.choiceSelected ? "◉" : "○"} ${body}`);
        break;
      case "result":
        listItem(block.marker ? "ol" : "ul", indent, body);
        break;
      case "quote":
        closeLists(0);
        if (!quote) out.push("<blockquote>");
        quote = true;
        out.push(`<p>${body}</p>`);
        break;
      default: {
        if (/^\s*(?:---|\*\*\*|___)\s*$/.test(raw)) {
          closeLists(0);
          closeQuote();
          out.push("<hr>");
          break;
        }
        const top = stack[stack.length - 1];
        if (top && indent > top.indent && top.open) {
          // an indented continuation stays inside the open item
          out.push(`<br>${image ? body : inlineHtml(raw.trim())}`);
          break;
        }
        closeLists(0);
        closeQuote();
        out.push(`<p>${image ? body : inlineHtml(raw)}</p>`);
      }
    }
  }
  if (fence !== null) out.push(`<pre><code>${escapeHtml(fenceLines.join("\n"))}</code></pre>`);
  closeLists(0);
  closeQuote();
  return out.join("\n");
}

/** Every image source in the selection, in order, once. */
export function imageSourcesIn(markdown: string): string[] {
  const seen = new Set<string>();
  for (const line of markdown.split("\n")) {
    const image = imageSourceSpan(line, 0);
    if (image && !seen.has(image.src)) seen.add(image.src);
  }
  return [...seen];
}
