// Hand to AI (Round Three, 2026-09-26): read one note and build the prompt the
// user carries to another agent. The prompt leaves Rotli by the user's own
// paste, so the secure-note law applies here too: a secure note, or one whose
// text looks like a secret, is refused — fail closed, the way a remote model
// is refused.

import { looksSecret } from "../ai/guard";
import { flushNote } from "../editor/model";
import { buildHandToAiPrompt } from "../lib/handToAi";
import { corpusFrontmatter } from "../lib/tauri";
import { isSecureBrainFolder, isSecureNotesFolder } from "../security/secureNotes";
import type { Note } from "../types";
import { notesService } from "./notes";

export type HandToAi =
  | { kind: "ready"; title: string; prompt: string }
  | { kind: "secure"; title: string }
  | { kind: "secret"; title: string }
  | { kind: "empty"; title: string };

async function isSecure(note: Note): Promise<boolean> {
  if (note.secure === true) return true;
  const folders = [note.folderId, note.diskFolderId ?? note.folderId];
  if (folders.some((folder) => isSecureNotesFolder(folder) || isSecureBrainFolder(folder))) return true;
  // the Rust adapter keeps `secure` in frontmatter; an unreadable answer is secure
  const frontmatter = await corpusFrontmatter(note.id).catch(() => ({ secure: true }));
  return frontmatter?.secure === true;
}

export async function handToAiFor(noteId: string): Promise<HandToAi> {
  // the last keystrokes may still sit in the editor's 400ms save window
  await flushNote(noteId);
  const note = await notesService.getNote(noteId);
  if (!note) throw new Error("Rotli couldn’t find this note.");
  const title = note.title || "Untitled";
  if (await isSecure(note)) return { kind: "secure", title };
  if (looksSecret(note.body)) return { kind: "secret", title };
  if (!note.body.trim()) return { kind: "empty", title };
  return { kind: "ready", title, prompt: buildHandToAiPrompt({ title, body: note.body }) };
}
