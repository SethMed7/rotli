// Where a note's image link points, in every form a Markdown vault uses:
// Rotli's `storage:` shorthand, a vault-root path (Rotli's reading), a path
// relative to the note (CommonMark, Obsidian, GitHub), and Obsidian's
// `![[name.png]]`, which names a file anywhere in the vault. Reading never
// rewrites the note; only Rotli's own `storage:` links are ever repaired in
// place (owner rule 2026-10-13: Rotli never rearranges a person's notes).
import { Facet } from "@codemirror/state";

import { corpusFileStat, resolveImageSrc } from "../lib/tauri";

/** The open note's physical folder (vault-relative, "" at the root), provided
 * by cmEditor beside noteIdFacet so a note-relative image can resolve. */
export const noteFolderFacet = Facet.define<string, string>({
  combine: (values) => values[0] ?? "",
});

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** A Markdown link target relative to the note's folder, as a vault-root path.
 * `<…>` brackets and `%XX` escapes are undone; a leading `/` means the vault
 * root. Null for a URL or scheme, or a path that climbs out of the vault. */
export function noteRelativePath(noteFolder: string, src: string): string | null {
  let target = src.trim();
  if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
  if (!target || SCHEME.test(target)) return null;
  try {
    target = decodeURIComponent(target);
  } catch {
    // a stray % stays literal
  }
  const fromRoot = target.startsWith("/");
  const parts = [...(fromRoot ? [] : noteFolder.split("/")), ...target.split("/")];
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(part);
  }
  return out.length > 0 ? out.join("/") : null;
}

/** Only Rotli's own `storage:` links are repaired by rewriting the note; every
 * other form is the person's, so a found image is shown and the link kept. */
export function healable(src: string): boolean {
  return src.startsWith("storage:");
}

const wireId = (rootId: string, rel: string) => (rootId === "default" ? rel : `${rootId}:${rel}`);
async function exists(rootId: string, rel: string): Promise<boolean> {
  return (await corpusFileStat(wireId(rootId, rel)).catch(() => null)) !== null;
}

/** A display URL for an image link in a note. Rotli's root-relative reading
 * comes first, so every existing Rotli link behaves exactly as before; a path
 * that only exists relative to the note is the fallback. "" means unresolved
 * (the caller then looks the file up by name). */
export async function resolveNoteImage(src: string, rootId: string, noteFolder: string): Promise<string> {
  const fromNote = noteRelativePath(noteFolder, src);
  if (fromNote && fromNote !== src && !SCHEME.test(src) && !(await exists(rootId, src))) {
    if (await exists(rootId, fromNote)) return resolveImageSrc(fromNote, rootId);
  }
  return resolveImageSrc(src, rootId);
}
