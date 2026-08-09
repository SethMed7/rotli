import type { DocumentBlock, DocumentDraft, EditableDocument } from "../documents/model";

export const CHAT_ARTIFACT_KINDS = ["document", "sheet", "pdf"] as const;
export type ChatArtifactKind = (typeof CHAT_ARTIFACT_KINDS)[number];

export function isChatArtifactKind(value: string): value is ChatArtifactKind {
  return (CHAT_ARTIFACT_KINDS as readonly string[]).includes(value);
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

/** AI reads the same structured DOCX subset the editor owns; formatting is
 * omitted while paragraph and table order remain inspectable. */
export function editableDocumentText(document: EditableDocument): string {
  return document.content
    .map((content) => {
      if (content.kind === "paragraph") {
        return content.paragraph.runs.map((run) => run.text).join("");
      }
      return content.table.rows
        .map((row) =>
          row.cells
            .map((cell) =>
              cell.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join("")).join(" "),
            )
            .join("\t"),
        )
        .join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}
