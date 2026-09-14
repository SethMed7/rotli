import { ORDERED_MARKER_SOURCE } from "../editor/listMarkers";
import type {
  DocumentContent,
  DocumentDraft,
  DocumentNamedStyle,
  DocumentParagraph,
  DocumentTable,
} from "./model";

const NUMBERED_ITEM = new RegExp(String.raw`^(?:${ORDERED_MARKER_SOURCE}|\d+\))\s+(.+)$`);

function inlineText(source: string): string {
  return source
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_whole, alt: string, path: string) =>
      alt.trim() ? `[Image placement: ${alt.trim()} — ${path.trim()}]` : `[Image placement — ${path.trim()}]`,
    )
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_([^_]+)_(?!_)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => inlineText(cell));
}

function isTableSeparator(line: string): boolean {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function paragraph(
  text: string,
  options: Pick<DocumentParagraph, "namedStyle" | "list"> = {},
): DocumentContent {
  return {
    kind: "paragraph",
    paragraph: {
      runs: [{ text }],
      ...(options.namedStyle ? { namedStyle: options.namedStyle } : {}),
      ...(options.list ? { list: options.list } : {}),
    },
  };
}

function tableContent(rows: string[][], index: number): DocumentContent {
  const table: DocumentTable = {
    id: `table-${index}`,
    rows: rows.map((row) => ({
      cells: row.map((cell) => ({ paragraphs: [{ runs: [{ text: cell }] }] })),
    })),
  };
  return { kind: "table", table };
}

/** Convert model-authored Markdown-like structure at the creation boundary.
 * DOCX remains a conventional file; Markdown syntax never becomes its storage
 * model. Ordered headings, prose, native lists, and tables retain their layout. */
export function documentDraftFromMarkdown(title: string, body: string): DocumentDraft {
  const content: DocumentContent[] = [];
  const lines = body.replaceAll("\r\n", "\n").split("\n");
  const prose: string[] = [];
  let inFence = false;
  let tableIndex = 0;
  let skippedLeadH1 = false;

  const flushProse = () => {
    const text = inlineText(prose.join(" "));
    prose.length = 0;
    if (text) content.push(paragraph(text));
  };

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? "";
    const trimmed = raw.trim();
    if (trimmed.startsWith("```")) {
      flushProse();
      inFence = !inFence;
      continue;
    }
    if (!trimmed) {
      flushProse();
      continue;
    }

    if (!inFence && trimmed.includes("|") && isTableSeparator(lines[index + 1] ?? "")) {
      flushProse();
      const rows = [tableCells(raw)];
      index += 2;
      while (index < lines.length && (lines[index] ?? "").includes("|")) {
        rows.push(tableCells(lines[index] ?? ""));
        index += 1;
      }
      index -= 1;
      content.push(tableContent(rows, ++tableIndex));
      continue;
    }

    const heading = !inFence ? trimmed.match(/^(#{1,3})\s+(.+)$/) : null;
    if (heading) {
      flushProse();
      const level = heading[1]?.length ?? 2;
      const text = inlineText(heading[2] ?? "");
      // The tool title is the canonical title paragraph. A model often repeats
      // it with slightly different punctuation, so the first H1 is always a
      // duplicate at this boundary rather than a second visible title.
      if (level === 1 && !skippedLeadH1 && content.length === 0) {
        skippedLeadH1 = true;
        continue;
      }
      const namedStyle = `heading${level}` as DocumentNamedStyle;
      if (text) content.push(paragraph(text, { namedStyle }));
      continue;
    }

    const bullet = !inFence ? trimmed.match(/^[-*+]\s+(.+)$/) : null;
    const numbered = !inFence ? trimmed.match(NUMBERED_ITEM) : null;
    if (bullet || numbered) {
      flushProse();
      const text = inlineText((bullet?.[1] ?? numbered?.[1] ?? "").trim());
      if (text) content.push(paragraph(text, { list: bullet ? "bullet" : "number" }));
      continue;
    }

    prose.push(trimmed.replace(/^>\s?/, ""));
  }
  flushProse();

  return {
    title: title.trim(),
    ...(content.length > 0 ? { content } : {}),
  };
}
