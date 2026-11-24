// What a chat project means at send time (docs/design/sidebar-home-chat.md,
// "Projects"): a new chat joins the project it was opened from, and every
// turn in a project carries the project's instructions.
//
// Instructions are the person's own prose, so they live in an ordinary
// Markdown note — searchable, portable, able to carry `secure:` and `locked:`
// — and the project manifest only names that note. A turn never reads the
// note here: the agent loop reads it through the host's gated read for the
// turn's model (ai/loop.ts readProjectInstructions), which refuses a secure
// note to a remote model and taints the chat when an on-device model reads
// one. What this module adds is the pre-flight the chat needs BEFORE the run
// (is the note secure? then the turn is on-device only, and the web follows),
// and the filing of a new chat into its project after it is saved.

import { corpusFrontmatter } from "../lib/tauri";
import type { MemexInstance } from "../memex/config";
import {
  type ChatFolder,
  type ChatFoldersManifest,
  assignChatToFolder,
  loadChatFolders,
  setChatFolderInstructionsNote,
  updateChatProjects,
} from "./chatFolders";
import { createChatNote } from "./createNote";

/** Where a new chat was opened from: a chat that was focused, or a project page. */
export type NewChatOrigin = { chatSlug: string } | { projectId: string };

/** The project a chat belongs to, or null. */
export function projectOf(manifest: ChatFoldersManifest, slug: string): ChatFolder | null {
  const id = manifest.assignments[slug];
  return (id && manifest.folders.find((folder) => folder.id === id)) || null;
}

/** The project a chat born from `origin` joins — the origin chat's project, or
 * the project whose page opened it. A project deleted since yields none. */
export function inheritedProjectId(
  manifest: ChatFoldersManifest,
  origin: NewChatOrigin | null,
): string | null {
  if (!origin) return null;
  const id = "projectId" in origin ? origin.projectId : manifest.assignments[origin.chatSlug];
  return id && manifest.folders.some((folder) => folder.id === id) ? id : null;
}

/** The project this turn runs in: the saved chat's own, else (a chat not yet
 * saved) the one it will join on save. */
export function turnProject(
  manifest: ChatFoldersManifest,
  slug: string | null,
  born: NewChatOrigin | null,
): ChatFolder | null {
  const own = slug ? projectOf(manifest, slug) : null;
  if (own) return own;
  const joins = inheritedProjectId(manifest, born);
  return manifest.folders.find((folder) => folder.id === joins) ?? null;
}

/** The pre-flight verdict for one turn's project instructions (a refusal is
 * the chat's words, without the warning mark the chat adds). */
export type ProjectPreflight =
  | { noteId: string | null; secure: boolean }
  /** Nothing may be sent: the chat says this, in these words. */
  | { refusal: string };

/** Before the run: which instructions note this turn carries, and whether it
 * is secure (then only an on-device model may run the turn, and the web stays
 * off). A note whose security cannot be read refuses the turn rather than
 * guessing; a manifest that cannot be read means no project, as before. */
export async function projectPreflight(
  active: MemexInstance,
  slug: string | null,
  born: NewChatOrigin | null,
  saveFailure: (noteId: string) => Promise<string | null>,
): Promise<ProjectPreflight> {
  let noteId: string | undefined;
  try {
    noteId = turnProject((await loadChatFolders(active)).manifest, slug, born)?.instructionsNote;
  } catch {
    return { noteId: null, secure: false };
  }
  if (!noteId) return { noteId: null, secure: false };
  try {
    const frontmatter = await corpusFrontmatter(noteId);
    if (!frontmatter) throw new Error("the instructions note has no readable security state");
    // the instructions are read as saved: wait for the editor's save, or say why not
    const unsaved = await saveFailure(noteId);
    if (unsaved) return { refusal: unsaved };
    return { noteId, secure: frontmatter.secure === true };
  } catch {
    return {
      refusal:
        "Rotli couldn’t read this project’s instructions, so nothing was sent. Open the project to fix or unlink them.",
    };
  }
}

/** Said when a project's secure instructions meet a remote model. */
export const SECURE_PROJECT_NOTICE =
  "This project’s instructions are a secure note, so its chats run only on on-device models. Choose one to continue.";

/** After a new chat is saved: file it into the project it was opened from.
 * Best-effort — a manifest hiccup never fails the send. */
export async function fileNewChat(
  active: MemexInstance,
  slug: string,
  born: NewChatOrigin | null,
): Promise<void> {
  if (!born) return;
  try {
    const manifest = (await loadChatFolders(active)).manifest;
    const joins = manifest.assignments[slug] ? null : inheritedProjectId(manifest, born);
    if (joins) await updateChatProjects(active, (m) => assignChatToFolder(m, slug, joins));
  } catch {
    /* the chat still saved — filing is recoverable from its menu */
  }
}

/** Make the note that holds a project's instructions and link it. The note is
 * the PERSON's (no AI creator), so no model may rewrite it without their
 * grant, and they can mark it secure or locked like any note. If the link
 * fails after the note exists, the error says which note it is. */
export async function createProjectInstructions(
  active: MemexInstance,
  projectId: string,
  projectName: string,
): Promise<string> {
  const title = `${projectName} — project instructions`;
  const created = await createChatNote(active, `# ${title}\n\n`);
  try {
    await updateChatProjects(active, (m) => setChatFolderInstructionsNote(m, projectId, created.id));
  } catch (err) {
    throw new Error(
      `the note “${title}” was made but couldn’t be linked to the project (${
        err instanceof Error ? err.message : String(err)
      }) — try again from the project page`,
    );
  }
  return created.id;
}
