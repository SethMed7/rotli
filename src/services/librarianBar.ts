// Talk to the Librarian (`/librarian`, 2026-09-28; plan:
// docs/design/librarian-bar.md) — the effectful half: who may ask, each turn's
// model call, and applying what the person accepts. Every write rides the
// Librarian's own gates (Rust re-refuses locked, secure, and out-of-Library
// notes) and is journaled with its `before`, so Librarian Activity can undo
// it. The note's prose is never edited.

import { looksSecret } from "../ai/guard";
import type { Host } from "../ai/types";
import { addAnchor, type LibrarianAction, mergeTags } from "../lib/librarianActions";
import {
  latestHighlight,
  type LibrarianContext,
  librarianChatMessages,
  type LibrarianTurn,
  splitLibrarianReply,
} from "../lib/librarianChat";
import {
  corpusFrontmatter,
  corpusNotePath,
  corpusSetAiField,
  type FrontmatterView,
  organizerLearnField,
} from "../lib/tauri";
import { fileNoteToArea } from "./brainFiling";
import type { BrainAction } from "./brainJournal";
import { logAction } from "./brainJournalStore";
import { invalidateJournal, invalidateNotes } from "./hooks";

export const LIBRARIAN_REFUSALS = {
  web: "The Librarian works in the Mac app.",
  off: "The Librarian is off for this vault. Turn it on in Settings → Librarian.",
  locked: "This note is locked, so the Librarian won’t touch it.",
  secure: "The Librarian doesn’t organize secure notes.",
  library: "The Librarian only organizes notes in the Library.",
  secret:
    "This note looks like it holds a secret, so the Librarian won’t send it to a model. Remove it, or make the note secure.",
} as const;

export interface LibrarianDeps {
  frontmatter: (id: string) => Promise<FrontmatterView | null>;
  notePath: (id: string) => Promise<string>;
  setAiField: (id: string, key: string, value: string) => Promise<void>;
  log: (action: Omit<BrainAction, "id" | "ts" | "status">) => Promise<unknown>;
  learnField: (note: string, key: string, value: string) => Promise<void>;
  fileNote: (id: string, area: string) => Promise<string>;
  refresh: () => Promise<void>;
}

export const liveLibrarianDeps: LibrarianDeps = {
  frontmatter: corpusFrontmatter,
  notePath: corpusNotePath,
  setAiField: corpusSetAiField,
  log: logAction,
  learnField: organizerLearnField,
  fileNote: (id, area) => fileNoteToArea(id, area),
  refresh: async () => {
    await invalidateJournal();
    await invalidateNotes();
  },
};

/** A field's value off the frontmatter view ("" when unset). */
function fieldValue(fm: FrontmatterView, key: string): string {
  for (const line of fm.fields) {
    const at = line.indexOf(":");
    if (at > 0 && line.slice(0, at).trim() === key) return line.slice(at + 1).trim();
  }
  return "";
}

/** Why the Librarian can't take this note, or null when it can. Checked
 * before any prompt exists; unknown state counts as locked. */
export async function librarianRefusal(
  noteId: string,
  where: { native: boolean; librarianOn: boolean },
  deps: Pick<LibrarianDeps, "frontmatter" | "notePath"> = liveLibrarianDeps,
): Promise<string | null> {
  if (!where.native) return LIBRARIAN_REFUSALS.web;
  if (!where.librarianOn) return LIBRARIAN_REFUSALS.off;
  const fm = await deps.frontmatter(noteId).catch(() => null);
  if (!fm || fm.locked) return LIBRARIAN_REFUSALS.locked;
  if (fm.secure) return LIBRARIAN_REFUSALS.secure;
  const rel = await deps.notePath(noteId).catch(() => "");
  const inLibrary = rel.startsWith("wiki/") && !rel.startsWith("wiki/_secure");
  return inLibrary ? null : LIBRARIAN_REFUSALS.library;
}

/** The note's current tags, for the prompt. */
export async function currentTags(
  noteId: string,
  deps: Pick<LibrarianDeps, "frontmatter"> = liveLibrarianDeps,
): Promise<string[]> {
  const fm = await deps.frontmatter(noteId).catch(() => null);
  const value = fm ? fieldValue(fm, "tags") : "";
  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export type LibrarianReply =
  | { kind: "secret" }
  | { kind: "reply"; prose: string; actions: LibrarianAction[]; handoff: boolean; raw: string };

/** One turn of the conversation. The secret check reads exactly what would be
 * sent — the rules, the note, and every turn so far — on every turn. */
export async function converseLibrarian(
  ctx: LibrarianContext,
  turns: readonly LibrarianTurn[],
  host: Pick<Host, "complete">,
): Promise<LibrarianReply> {
  const messages = librarianChatMessages(ctx, turns);
  if (looksSecret(messages.map((message) => message.content).join("\n"))) return { kind: "secret" };
  const raw = await host.complete({ messages });
  const { prose, actions, handoff } = splitLibrarianReply(raw, {
    doc: ctx.doc,
    highlight: latestHighlight(turns),
    areas: ctx.areas,
  });
  return { kind: "reply", prose, actions, handoff, raw };
}

/** Apply accepted actions: tags and passage marks first, filing last (a
 * filing moves the note). Each field write is journaled with its `before`,
 * and taught to the organizer as the Librarian's own, like an Approve. */
export async function applyLibrarian(
  actions: readonly LibrarianAction[],
  note: { id: string; title: string; model: string },
  deps: LibrarianDeps = liveLibrarianDeps,
): Promise<number> {
  const fm = await deps.frontmatter(note.id);
  if (!fm) throw new Error("Couldn’t read this note’s metadata.");
  const rel = await deps.notePath(note.id);
  const values = { tags: fieldValue(fm, "tags"), anchors: fieldValue(fm, "anchors") };
  let applied = 0;
  const write = async (field: "tags" | "anchors", after: string) => {
    const before = values[field];
    if (after === before) return;
    await deps.setAiField(note.id, field, after);
    values[field] = after;
    applied++;
    await deps.log({
      action: "field",
      field,
      noteId: rel,
      noteUlid: fm.id,
      noteTitle: note.title,
      before,
      after,
      model: note.model,
    });
    await deps.learnField(fm.id || rel, field, after).catch(() => {});
  };
  for (const action of actions) {
    if (action.type === "tag") await write("tags", mergeTags(values.tags, action.tags));
    if (action.type === "mark") await write("anchors", addAnchor(values.anchors, action.anchor));
  }
  const filing = actions.find((action) => action.type === "file");
  if (filing?.type === "file") {
    await deps.fileNote(note.id, filing.area); // journals the move itself
    applied++;
  }
  await deps.refresh();
  return applied;
}
