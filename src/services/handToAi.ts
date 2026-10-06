// Hand to AI (Round Three, 2026-09-26): read one note and build the prompt the
// user carries to another agent. The prompt leaves Rotli by the user's own
// paste, so the secure-note law applies here too: a secure note, or one whose
// text looks like a secret, is refused — fail closed, the way a remote model
// is refused. The files a note links to follow the same law (v2, 2026-10-02):
// one in a secure place refuses the whole handoff, and the rest become paths an
// outside agent can open, missing ones named as missing.

import { looksSecret } from "../ai/guard";
import { refineHandoff } from "../ai/handToAiRefine";
import { qualifiedArtifactId } from "../ai/imageLinks";
import type { Host } from "../ai/types";
import { flushNote } from "../editor/model";
import {
  type AttachmentLink,
  type AttachmentPlace,
  attachmentLinks,
  buildHandToAiPrompt,
} from "../lib/handToAi";
import { secureByName } from "../lib/librarianRules";
import {
  corpusAbs,
  corpusFileStat,
  corpusFrontmatter,
  corpusNotePath,
  isTauri,
  rootIdOf,
} from "../lib/tauri";
import { currentWebFileStore } from "../lib/webAiSeam";
import {
  isSecureBrainFolder,
  isSecureNotesFolder,
  SECURE_BRAIN_FOLDER,
  SECURE_NOTES_FOLDER,
} from "../security/secureNotes";
import { useLibrarianRules } from "../state/librarianRules";
import type { Note } from "../types";
import { imageSrcToRel } from "./imageRepair";
import { notesService } from "./notes";

export type HandToAi =
  /** `paths`: every path the Attachments list names (found and missing); a
   * refined prompt must keep them all */
  | { kind: "ready"; title: string; prompt: string; paths: string[] }
  | { kind: "secure"; title: string }
  | { kind: "secureAttachment"; title: string }
  | { kind: "secret"; title: string }
  | { kind: "empty"; title: string };

/** A file name Rotli couldn't read counts as secure: fail closed, like the
 * frontmatter check (a keyword could be in the name it couldn't see). */
export function secureByNameOrUnknown(
  title: string,
  rel: string | null,
  keywords: readonly string[],
): boolean {
  return rel === null || secureByName(title, rel, keywords);
}

async function isSecure(note: Note): Promise<boolean> {
  if (note.secure === true) return true;
  const folders = [note.folderId, note.diskFolderId ?? note.folderId];
  if (folders.some((folder) => isSecureNotesFolder(folder) || isSecureBrainFolder(folder))) return true;
  // the Rust adapter keeps `secure` in frontmatter; an unreadable answer is secure
  const frontmatter = await corpusFrontmatter(note.id).catch(() => ({ secure: true }));
  if (frontmatter?.secure === true) return true;
  // a secure keyword in its title or file name makes it secure too, as the
  // Librarian treats it, even before a save has flagged it
  const { secureKeywords } = useLibrarianRules.getState().rules;
  if (secureKeywords.length === 0) return false;
  // Rotli Web has no path lookup (the title still counts there); in the Mac
  // app a failed lookup is unknown, and unknown is secure
  const rel = isTauri() ? await corpusNotePath(note.id).catch(() => null) : "";
  return secureByNameOrUnknown(note.title, rel, secureKeywords);
}

/** Finds a linked file by its normalized vault-relative path (`attachmentRel`):
 * its absolute path in the Mac app; on Rotli Web, which has no file paths, the
 * vault-relative path, once the connected folder (or the browser vault) says
 * the file is there. A file Rotli can't check is listed as missing, never as
 * found. */
export type LocateAttachment = (rootId: string, rel: string) => Promise<AttachmentPlace>;

const UNSAFE_SEGMENT = /(^|\/)\.{1,2}(\/|$)/;

/** The editor's own resolution (`corpus_abs`, as the inline image widget
 * uses), plus a stat so a file that isn't there says missing. */
export const locateAttachment: LocateAttachment = async (rootId, rel) => {
  // `attachmentRel` already resolved `.` and `..`; never guess past one here
  if (UNSAFE_SEGMENT.test(rel)) return { status: "missing", rel };
  if (!isTauri()) {
    const store = currentWebFileStore();
    const there = store ? await store.fileExists(rel).catch(() => false) : false;
    return there ? { status: "found", rel, path: null } : { status: "missing", rel };
  }
  const stat = await corpusFileStat(qualifiedArtifactId(rootId, rel)).catch(() => null);
  if (!stat) return { status: "missing", rel };
  const path = await corpusAbs(rootId, rel).catch(() => "");
  return path ? { status: "found", rel, path } : { status: "missing", rel };
};

const fold = (text: string) => text.toLowerCase();
const SECURE_FOLDERS = [SECURE_NOTES_FOLDER, SECURE_BRAIN_FOLDER].map(fold);
/** More rounds of percent-escapes than this is an attempt to hide a path. */
const DECODE_ROUNDS = 4;
// control characters are never part of a vault file name
const hasControl = (text: string) =>
  [...text].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

/** A link's destination as the vault-relative path it can reach, or null when
 * it can't be read with certainty: escapes undone (repeatedly; a malformed one
 * is null), `storage:` expanded, backslashes as slashes, and `.`/`..` resolved.
 * A path that climbs out of the vault is null. Null is unsafe: the caller
 * refuses, the way a secure link is refused. */
export function attachmentRel(src: string): string | null {
  let text = src;
  for (let round = 0; ; round += 1) {
    let next: string;
    try {
      next = decodeURIComponent(text);
    } catch {
      return null;
    }
    if (next === text) break;
    if (round === DECODE_ROUNDS) return null;
    text = next;
  }
  if (hasControl(text)) return null;
  const parts: string[] = [];
  for (const part of imageSrcToRel(text).replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.pop() === undefined) return null;
      continue;
    }
    parts.push(part);
  }
  return parts.length > 0 ? parts.join("/") : null;
}

/** A link into a secure folder, or to a file named with a secure keyword, is
 * as secure as a note there; one Rotli can't read with certainty
 * (`attachmentRel` null) counts as secure. The Mac's disk ignores case, so the
 * folder test does too. */
export function attachmentIsSecure(src: string, keywords: readonly string[]): boolean {
  const rel = attachmentRel(src);
  if (rel === null) return true;
  const cut = rel.lastIndexOf("/");
  const folder = fold(cut < 0 ? "" : rel.slice(0, cut));
  if (SECURE_FOLDERS.some((secure) => folder === secure || folder.startsWith(`${secure}/`))) return true;
  const name = rel.slice(cut + 1).replace(/\.[^.]*$/, "");
  return keywords.length > 0 && secureByName(name, rel, keywords);
}

async function placesOf(
  links: readonly AttachmentLink[],
  rootId: string,
  locate: LocateAttachment,
): Promise<Map<string, AttachmentPlace>> {
  const places = await Promise.all(
    links.map(async (link) => {
      // the refusal ran first, so every link here has a readable path
      const rel = attachmentRel(link.src);
      const place: AttachmentPlace =
        rel === null ? { status: "missing", rel: link.src } : await locate(rootId, rel);
      return [link.src, place] as const;
    }),
  );
  return new Map(places);
}

export async function handToAiFor(
  noteId: string,
  locate: LocateAttachment = locateAttachment,
): Promise<HandToAi> {
  // the last keystrokes may still sit in the editor's 400ms save window
  await flushNote(noteId);
  const note = await notesService.getNote(noteId);
  if (!note) throw new Error("Rotli couldn’t find this note.");
  const title = note.title || "Untitled";
  if (await isSecure(note)) return { kind: "secure", title };
  if (looksSecret(note.body)) return { kind: "secret", title };
  if (!note.body.trim()) return { kind: "empty", title };
  const links = attachmentLinks(note.body);
  const { secureKeywords } = useLibrarianRules.getState().rules;
  if (links.some((link) => attachmentIsSecure(link.src, secureKeywords))) {
    return { kind: "secureAttachment", title };
  }
  const attachments = await placesOf(links, rootIdOf(note.id), locate);
  // a refined prompt must keep every path the Attachments list names, missing ones too
  const paths = [...attachments.values()].map((place) =>
    place.status === "found" ? (place.path ?? place.rel) : place.rel,
  );
  return {
    kind: "ready",
    title,
    prompt: buildHandToAiPrompt({ title, body: note.body, attachments }),
    paths,
  };
}

export type RefinedHandToAi =
  | { kind: "refined"; title: string; prompt: string }
  /** Basic, because the model's answer couldn't be used this time; `reason` says why */
  | { kind: "fallback"; title: string; prompt: string; reason: string }
  | Exclude<HandToAi, { kind: "ready" }>;

/** Refined mode: the note is read and every refusal asked again first (a note
 * made secure since the card opened is never sent), then the Librarian's model
 * rewrites the Basic handoff. Any failure gives back Basic with the reason. */
export async function refineHandToAiFor(
  noteId: string,
  host: Pick<Host, "complete">,
  locate: LocateAttachment = locateAttachment,
): Promise<RefinedHandToAi> {
  const basic = await handToAiFor(noteId, locate);
  if (basic.kind !== "ready") return basic;
  const verdict = await refineHandoff(host, basic.prompt, basic.paths);
  return verdict.ok
    ? { kind: "refined", title: basic.title, prompt: verdict.prompt }
    : { kind: "fallback", title: basic.title, prompt: basic.prompt, reason: verdict.reason };
}
