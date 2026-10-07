// Note cards' view of the vault (split from composition.ts, 2026-10-06): the
// note a card's path names (title, body, secure) and what `[[target]]`
// resolves to — the editor's own resolver.

import { useQueries } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import { looksSecret } from "../ai/guard";
import { buildWikilinkIndex, resolveWikilink } from "../editor/wikilink";
import { inSecureFolder } from "../security/secureNotes";
import { keys, useNoteLinks, useSearchableNotes } from "../services/hooks";
import { notesService } from "../services/notes";
import type { Note, NoteSummary } from "../types";
import { noteAtPath, notePath } from "./notePaths";

/** What a note card shows of its note. */
export interface CanvasNoteView {
  title: string;
  /** null while the body loads. */
  body: string | null;
  /** Title shows, text never does — a screen may be shared. */
  secure: boolean;
  /** The note is there but couldn't be read just now. */
  failed?: boolean;
}

/** What a note card may show of its note. "unknown" until the Links
 * projection has answered — nothing is fetched or shown meanwhile — and
 * "secure" when the projection says so, when it failed, when the note isn't
 * in it (another vault), or when its own flag or folder says so. Secure
 * notes fail closed (audit 2026-10-06, P0). */
export type CardAccess = "unknown" | "secure" | "open";

export function cardAccess(
  note: Pick<NoteSummary, "id" | "secure" | "folderId" | "diskFolderId">,
  projection: "pending" | "error" | "success",
  secureById: ReadonlyMap<string, boolean>,
): CardAccess {
  const flagged = note.secure === true || inSecureFolder(note);
  if (flagged || projection === "error") return "secure";
  if (projection === "pending") return "unknown";
  return secureById.get(note.id) === false ? "open" : "secure";
}

/** One note card's read of its note: whether the note is there, its body,
 * and whether that body may show. Bodies are judged as they are now — a
 * body that has since gained a secret closes the card even before the Links
 * projection catches up (ROTLI review, PR 173). */
export function cardView(
  note: Pick<NoteSummary, "title">,
  access: CardAccess,
  read: { status: "pending" | "error" | "success"; data: Note | null | undefined } | undefined,
): CanvasNoteView | "gone" {
  if (access !== "open") return { title: note.title, body: null, secure: access === "secure" };
  if (read?.status === "error") return { title: note.title, body: null, secure: false, failed: true };
  if (read?.status !== "success") return { title: note.title, body: null, secure: false };
  if (!read.data) return "gone";
  const secure = read.data.secure === true || looksSecret(read.data.body);
  return { title: note.title, body: secure ? null : read.data.body, secure };
}

/** Note cards' view of the vault: a path's note (title, body, secure), and
 * what `[[target]]` resolves to — the editor's own resolver. Only Markdown
 * notes become note cards. */
export function useCanvasNotes(paths: readonly string[]) {
  const { notes } = useSearchableNotes();
  const links = useNoteLinks();
  const index = useMemo(() => buildWikilinkIndex(notes), [notes]);
  const projection = links.isSuccess ? "success" : links.isError ? "error" : "pending";
  const secureById = useMemo(
    () => new Map((links.data ?? []).map((row) => [row.noteId, row.secure] as const)),
    [links.data],
  );
  // only notes the projection says are open are read at all; their bodies
  // come through the note cache every save writes, so a card follows edits
  // made elsewhere, and a failed read is tried again when the canvas reopens
  // one read per note, however many cards show it
  const openIds = useMemo(
    () => [
      ...new Set(
        paths
          .map((path) => noteAtPath(notes, path))
          .filter(
            (note): note is NoteSummary =>
              note !== null &&
              (note.kind ?? "note") === "note" &&
              cardAccess(note, projection, secureById) === "open",
          )
          .map((note) => note.id),
      ),
    ],
    [paths, notes, projection, secureById],
  );
  const reads = useQueries({
    queries: openIds.map((id) => ({ queryKey: keys.note(id), queryFn: () => notesService.getNote(id) })),
  });
  const readById = new Map(openIds.map((id, at) => [id, reads[at]] as const));

  const noteFor = (path: string): CanvasNoteView | null => {
    const note = noteAtPath(notes, path);
    if (!note || (note.kind ?? "note") !== "note") return null;
    const view = cardView(note, cardAccess(note, projection, secureById), readById.get(note.id));
    return view === "gone" ? null : view;
  };
  const resolveLink = useCallback(
    (target: string) => {
      const id = resolveWikilink(target, index);
      const note = id ? notes.find((each) => each.id === id) : undefined;
      // a board or another canvas never becomes a note card
      return note && (note.kind ?? "note") === "note" ? notePath(note) : null;
    },
    [index, notes],
  );
  const noteIdAt = useCallback((path: string) => noteAtPath(notes, path)?.id ?? null, [notes]);
  // a dragged row's id → its card's path; only Markdown notes become note cards
  const notePathFor = useCallback(
    (noteId: string) => {
      const note = notes.find((each) => each.id === noteId);
      return note && (note.kind ?? "note") === "note" ? notePath(note) : null;
    },
    [notes],
  );
  return { noteFor, resolveLink, noteIdAt, notePathFor };
}
