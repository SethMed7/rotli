import { linkedText } from "../documents/aiEdit";
import type { DocumentBlock, DocumentDraft, EditableDocument } from "../documents/model";
import { LAUNCH_FEATURES } from "../lib/featurePolicy";

export const CHAT_ARTIFACT_KINDS = ["document", "sheet", "pdf"] as const;
export type ChatArtifactKind = (typeof CHAT_ARTIFACT_KINDS)[number];

export function isChatArtifactKind(value: string): value is ChatArtifactKind {
  return (CHAT_ARTIFACT_KINDS as readonly string[]).includes(value);
}

/** The kinds this build lets chat create: workbooks follow the sheets launch
 * capability, so stable builds offer documents and PDFs only. */
export function offeredArtifactKinds(features: { sheets: boolean } = LAUNCH_FEATURES): ChatArtifactKind[] {
  return CHAT_ARTIFACT_KINDS.filter((kind) => kind !== "sheet" || features.sheets);
}

/** Model titles are display copy, never paths. Keep one conservative filename
 * projection for every generated conventional file. */
export function artifactFileName(title: string, extension: "docx" | "xlsx" | "pdf"): string {
  const stem = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${stem || "untitled"}.${extension}`;
}

function plainInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/(`+|\*\*|__|~~)/g, "")
    .trim();
}

/** Convert the small, reliable Markdown subset models already produce into
 * Rotli's framework-free DOCX draft. The OOXML adapter remains the only place
 * that knows the file format. */
export function markdownToDocumentDraft(title: string, markdown: string): DocumentDraft {
  const blocks: DocumentBlock[] = [];
  let paragraph: string[] = [];
  let inFence = false;
  const flush = () => {
    const text = plainInline(paragraph.join(" "));
    if (text) blocks.push({ kind: "paragraph", text });
    paragraph = [];
  };

  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*```/.test(raw)) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      const text = raw.trimEnd();
      if (text) blocks.push({ kind: "paragraph", text });
      continue;
    }
    const heading = raw.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    if (heading) {
      flush();
      const headingText = plainInline(heading[2] ?? "");
      if (blocks.length === 0 && headingText.toLowerCase() === title.trim().toLowerCase()) continue;
      blocks.push({
        kind: "heading",
        level: Math.min(3, heading[1]!.length) as 1 | 2 | 3,
        text: headingText,
      });
      continue;
    }
    const bullet = raw.match(/^\s*[-*+]\s+(.+)$/);
    const numbered = raw.match(/^\s*\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      flush();
      blocks.push({
        kind: "paragraph",
        text: `${bullet ? "•" : "#"} ${plainInline((bullet ?? numbered)?.[1] ?? "")}`,
      });
      continue;
    }
    if (!raw.trim()) {
      flush();
      continue;
    }
    paragraph.push(raw.trim());
  }
  flush();
  return { title: title.trim(), ...(blocks.length > 0 ? { blocks } : {}) };
}

const STYLE_LABEL: Record<string, string> = {
  title: "Title",
  subtitle: "Subtitle",
  heading1: "Heading 1",
  heading2: "Heading 2",
  heading3: "Heading 3",
};

/** What the chat reads from a Word document (2026-10-01): numbered blocks it
 * can point at — headings with their level, list items, each table cell by
 * row and column, and images by their alt text — in document order. Empty
 * paragraphs keep their numbers: an edit's block numbers are positions in the
 * document (`applyDocumentEdits`), so none may be skipped. */
export function editableDocumentForAi(document: EditableDocument): string {
  return document.content
    .map((content, index) => {
      const n = `[${index + 1}]`;
      if (content.kind === "paragraph") {
        const { paragraph } = content;
        const kind =
          STYLE_LABEL[paragraph.namedStyle ?? ""] ??
          (paragraph.list ? `${paragraph.list} item` : "paragraph");
        return `${n} ${kind}: ${linkedText(paragraph)}`;
      }
      if (content.kind === "image") return `${n} image: ${content.image.alt?.trim() || content.image.name}`;
      const { rows } = content.table;
      const width = Math.max(0, ...rows.map((row) => row.cells.length));
      const cells = rows.flatMap((row, r) =>
        row.cells.map((cell, c) => `  r${r + 1}c${c + 1}: ${cell.paragraphs.map(linkedText).join(" ")}`),
      );
      return [`${n} table (${rows.length} rows × ${width} columns):`, ...cells].join("\n");
    })
    .join("\n");
}
