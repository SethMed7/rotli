// Obsidian's whole-line file embed, `![[budget.xlsx]]`, read as Rotli's live
// sheet, document, or board embed — the same editors the ```sheet / ```document
// / ```board fences mount. Owner decision 2026-10-13: Rotli reads Obsidian's
// embeds (and will write them); reading never changes the note.
import type { Text } from "@codemirror/state";

import { rootIdOf, splitRootId } from "../lib/corpusWireId";
import { extOf } from "../lib/fileKind";
import { notesService } from "../services/notes";
import { noteRelativePath } from "./imageSource";

export type EmbedKind = "board" | "sheet" | "document";

const KIND_BY_EXT: Readonly<Record<string, EmbedKind>> = {
  xlsx: "sheet",
  xlsm: "sheet",
  csv: "sheet",
  docx: "document",
  excalidraw: "board",
};

// the whole line is the embed; a `|size` or `#part` suffix is Obsidian's own
const WIKI_EMBED_LINE = /^!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]\s*$/;

export interface WikiEmbed {
  from: number;
  to: number;
  kind: EmbedKind;
  target: string;
}

/** Every whole-line `![[file]]` embed of a sheet, document, or board that
 * sits outside a fenced block. */
export function scanWikiEmbeds(doc: Text, fences: readonly { from: number; to: number }[]): WikiEmbed[] {
  const out: WikiEmbed[] = [];
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (!line.text.startsWith("![[")) continue;
    const match = WIKI_EMBED_LINE.exec(line.text);
    const target = match?.[1]?.trim() ?? "";
    const kind = KIND_BY_EXT[extOf(target)];
    if (!kind || fences.some((f) => line.from >= f.from && line.from <= f.to)) continue;
    out.push({ from: line.from, to: line.to, kind, target });
  }
  return out;
}

const baseName = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1);

/** Which vault file an embed names: the exact vault path, then the path
 * relative to the note, then the one file with that name anywhere (how
 * Obsidian resolves `![[name]]`). Null when missing or ambiguous. */
export function pickWikiEmbedFile(
  target: string,
  noteFolder: string,
  rels: readonly string[],
): string | null {
  if (rels.includes(target)) return target;
  const fromNote = noteRelativePath(noteFolder, target);
  if (fromNote && rels.includes(fromNote)) return fromNote;
  const name = baseName(target).toLowerCase();
  const named = rels.filter((rel) => baseName(rel).toLowerCase() === name);
  return named.length === 1 ? (named[0] ?? null) : null;
}

/** The embedded file's wire id in this note's vault root, or null. */
export async function resolveWikiEmbed(
  target: string,
  rootId: string,
  noteFolder: string,
): Promise<string | null> {
  const files = (await notesService.listNotes()).filter(
    (n) => n.kind === "file" && rootIdOf(n.id) === rootId,
  );
  const rel = pickWikiEmbedFile(
    target,
    noteFolder,
    files.map((n) => splitRootId(n.id).rel),
  );
  if (rel === null) return null;
  return rootId === "default" ? rel : `${rootId}:${rel}`;
}
