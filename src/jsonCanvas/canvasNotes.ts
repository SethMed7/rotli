// Note cards' view of the vault (split from composition.ts, 2026-10-06): the
// note a card's path names (title, body, secure) and what `[[target]]`
// resolves to — the editor's own resolver.

import { useCallback, useEffect, useMemo, useState } from "react";

import { buildWikilinkIndex, resolveWikilink } from "../editor/wikilink";
import { inSecureFolder } from "../security/secureNotes";
import { useNoteLinks, useSearchableNotes } from "../services/hooks";
import { notesService } from "../services/notes";
import type { NoteSummary } from "../types";
import { noteAtPath, notePath } from "./notePaths";

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

/** Note cards' view of the vault: a path's note (title, body, secure), and
 * what `[[target]]` resolves to — the editor's own resolver. Only Markdown
 * notes become note cards. */
export function useCanvasNotes(paths: readonly string[]) {
  const { notes } = useSearchableNotes();
  const links = useNoteLinks();
  // a fetched body, or null when the note couldn't be read (never refetched)
  const [bodies, setBodies] = useState<ReadonlyMap<string, string | null>>(new Map());
  const index = useMemo(() => buildWikilinkIndex(notes), [notes]);
  const projection = links.isSuccess ? "success" : links.isError ? "error" : "pending";
  const secureById = useMemo(
    () => new Map((links.data ?? []).map((row) => [row.noteId, row.secure] as const)),
    [links.data],
  );
  const wanted = useMemo(
    () =>
      paths
        .map((path) => noteAtPath(notes, path))
        .filter((note) => note !== null && (note.kind ?? "note") === "note"),
    [paths, notes],
  );

  useEffect(() => {
    let cancelled = false;
    const missing = wanted.filter(
      (note) => note !== null && !bodies.has(note.id) && cardAccess(note, projection, secureById) === "open",
    );
    if (missing.length === 0) return;
    void Promise.all(missing.map((note) => notesService.getNote(note!.id).catch(() => null))).then(
      (loaded) => {
        if (cancelled) return;
        setBodies((current) => {
          const next = new Map(current);
          missing.forEach((note, at) => next.set(note!.id, loaded[at]?.body ?? null));
          return next;
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [wanted, bodies, projection, secureById]);

  const noteFor = useCallback(
    (path: string) => {
      const note = noteAtPath(notes, path);
      if (!note || (note.kind ?? "note") !== "note" || bodies.get(note.id) === null) return null;
      const access = cardAccess(note, projection, secureById);
      return {
        title: note.title,
        body: access === "open" ? (bodies.get(note.id) ?? null) : null,
        secure: access === "secure",
      };
    },
    [notes, bodies, projection, secureById],
  );
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
