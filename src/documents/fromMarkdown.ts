import { ORDERED_MARKER_SOURCE } from "../editor/listMarkers";
import {
  type DocumentContent,
  type DocumentDraft,
  type DocumentNamedStyle,
  type DocumentParagraph,
  type DocumentRun,
  type DocumentTable,
  safeLinkUrl,
} from "./model";

const NUMBERED_ITEM = new RegExp(String.raw`^(?:${ORDERED_MARKER_SOURCE}|\d+\))\s+(.+)$`);

function plainText(source: string): string {
  return source
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_([^_]+)_(?!_)/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

/** Inline Markdown as runs: a web or mail `[text](url)` stays a link, any
 * other link keeps only its text; emphasis marks drop. Empty when blank. */
function inlineRuns(source: string): DocumentRun[] {
  const links: { label: string; url: string | undefined }[] = [];
  // each link waits behind a private-use placeholder, so emphasis around it
  // (`**[Rotli](https://rotli.co)**`) strips as a whole and its url stays whole
  const text = plainText(
    source
      .replace(/[\uE000\uE001]/g, "")
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_whole, alt: string, path: string) =>
        alt.trim()
          ? `[Image placement: ${alt.trim()} — ${path.trim()}]`
          : `[Image placement — ${path.trim()}]`,
      )
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_whole, label: string, url: string) =>
          `\uE000${links.push({ label, url: safeLinkUrl(url) }) - 1}\uE001`,
      ),
  );
  const runs: DocumentRun[] = [];
  const add = (piece: string, link?: string) => {
    const last = runs.at(-1);
    if (!piece) return;
    if (last && last.link === link) last.text += piece;
    else runs.push({ text: piece, ...(link ? { link } : {}) });
  };
  let cursor = 0;
  for (const match of text.matchAll(/\uE000(\d+)\uE001/g)) {
    add(text.slice(cursor, match.index));
    const link = links[Number(match[1])];
    add(plainText(link?.label ?? ""), link?.url);
    cursor = match.index + match[0].length;
  }
  add(text.slice(cursor));
  const first = runs[0];
  const last = runs.at(-1);
  if (first) first.text = first.text.trimStart();
  if (last) last.text = last.text.trimEnd();
  return runs.filter((run) => run.text);
}

const runsText = (runs: DocumentRun[]) => runs.map((run) => run.text).join("");

function tableCells(line: string): DocumentRun[][] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => inlineRuns(cell));
}

function isTableSeparator(line: string): boolean {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(runsText(cell)));
}

function paragraph(
  runs: DocumentRun[],
  options: Pick<DocumentParagraph, "namedStyle" | "list"> = {},
): DocumentContent {
  return {
    kind: "paragraph",
    paragraph: {
      runs,
      ...(options.namedStyle ? { namedStyle: options.namedStyle } : {}),
      ...(options.list ? { list: options.list } : {}),
    },
  };
}

function tableContent(rows: DocumentRun[][][], index: number): DocumentContent {
  const table: DocumentTable = {
    id: `table-${index}`,
    rows: rows.map((row) => ({
      cells: row.map((cell) => ({ paragraphs: [{ runs: cell.length ? cell : [{ text: "" }] }] })),
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
    const runs = inlineRuns(prose.join(" "));
    prose.length = 0;
    if (runs.length) content.push(paragraph(runs));
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
      const runs = inlineRuns(heading[2] ?? "");
      // The tool title is the canonical title paragraph. A model often repeats
      // it with slightly different punctuation, so the first H1 is always a
      // duplicate at this boundary rather than a second visible title.
      if (level === 1 && !skippedLeadH1 && content.length === 0) {
        skippedLeadH1 = true;
        continue;
      }
      const namedStyle = `heading${level}` as DocumentNamedStyle;
      if (runs.length) content.push(paragraph(runs, { namedStyle }));
      continue;
    }

    const bullet = !inFence ? trimmed.match(/^[-*+]\s+(.+)$/) : null;
    const numbered = !inFence ? trimmed.match(NUMBERED_ITEM) : null;
    if (bullet || numbered) {
      flushProse();
      const runs = inlineRuns((bullet?.[1] ?? numbered?.[1] ?? "").trim());
      if (runs.length) content.push(paragraph(runs, { list: bullet ? "bullet" : "number" }));
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
