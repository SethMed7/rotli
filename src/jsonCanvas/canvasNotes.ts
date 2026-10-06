// Note cards' view of the vault (split from composition.ts, 2026-10-06): the
// note a card's path names (title, body, secure) and what `[[target]]`
// resolves to — the editor's own resolver.

import { useCallback, useEffect, useMemo, useState } from "react";

import { buildWikilinkIndex, resolveWikilink } from "../editor/wikilink";
import { useNoteLinks, useSearchableNotes } from "../services/hooks";
import { notesService } from "../services/notes";
import { noteAtPath, notePath } from "./notePaths";

/** Note cards' view of the vault: a path's note (title, body, secure), and
 * what `[[target]]` resolves to — the editor's own resolver. */
export function useCanvasNotes(paths: readonly string[]) {
  const { notes } = useSearchableNotes();
  const links = useNoteLinks();
  const [bodies, setBodies] = useState<ReadonlyMap<string, string>>(new Map());
  const index = useMemo(() => buildWikilinkIndex(notes), [notes]);
  const secure = useMemo(
    () => new Set((links.data ?? []).filter((row) => row.secure).map((row) => row.noteId)),
    [links.data],
  );
  const wanted = useMemo(
    () => paths.map((path) => noteAtPath(notes, path)).filter((note) => note !== null),
    [paths, notes],
  );

  useEffect(() => {
    let cancelled = false;
    const missing = wanted.filter((note) => !bodies.has(note.id) && !secure.has(note.id));
    if (missing.length === 0) return;
    void Promise.all(missing.map((note) => notesService.getNote(note.id))).then((loaded) => {
      if (cancelled) return;
      setBodies((current) => {
        const next = new Map(current);
        for (const note of loaded) if (note) next.set(note.id, note.body);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [wanted, bodies, secure]);

  const noteFor = useCallback(
    (path: string) => {
      const note = noteAtPath(notes, path);
      if (!note) return null;
      return { title: note.title, body: bodies.get(note.id) ?? null, secure: secure.has(note.id) };
    },
    [notes, bodies, secure],
  );
  const resolveLink = useCallback(
    (target: string) => {
      const id = resolveWikilink(target, index);
      const note = id ? notes.find((each) => each.id === id) : undefined;
      return note ? notePath(note) : null;
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
