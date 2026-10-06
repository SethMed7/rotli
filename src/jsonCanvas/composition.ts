// Wires a `.canvas` file to the Canvas editor on the Mac app: read the file,
// parse it, and save edits back (debounced, revision-checked — a canvas
// changed on disk since it was read refuses instead of overwriting). Note
// cards resolve through the note list the editor already holds.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { resolveWikilink, buildWikilinkIndex } from "../editor/wikilink";
import { onQuitFlush } from "../lib/quitFlush";
import { corpusFileStat, corpusFileText, corpusWriteFileBytes, isTauri } from "../lib/tauri";
import { useNoteLinks, useSearchableNotes } from "../services/hooks";
import { notesService } from "../services/notes";
import { type CanvasDoc, parseCanvas, serializeCanvas } from "./model";
import { noteAtPath, notePath } from "./notePaths";

export type CanvasFileState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; doc: CanvasDoc; writable: boolean; saveError: string | null };

const SAVE_AFTER_MS = 500;
/** Bigger than any canvas a person draws; past it Rotli refuses rather than
 * open half a file. */
export const CANVAS_MAX_BYTES = 8_000_000;

export interface CanvasFileIo {
  native: () => boolean;
  stat: typeof corpusFileStat;
  text: typeof corpusFileText;
}
const liveIo: CanvasFileIo = { native: isTauri, stat: corpusFileStat, text: corpusFileText };

/** Why a canvas file didn't open — one wording, shared with the tests. */
export const CANVAS_LOAD_REFUSAL = {
  notHere: "Canvases open in the Mac app for now.",
  gone: "This canvas isn’t in the vault anymore.",
  tooLarge: "This canvas is too large to open.",
} as const;

/** Read and parse a canvas, failing closed: outside the Mac app the file
 * adapter would answer "" and accept saves without writing, so it refuses
 * instead of showing a blank canvas; the whole file is read (the adapter's
 * default cap would cut it short), and one too large to read is refused. */
export async function loadCanvasFile(
  fileId: string,
  io: CanvasFileIo = liveIo,
): Promise<{ state: CanvasFileState; revision: string | null }> {
  const refuse = (error: string) => ({ state: { status: "error", error } as const, revision: null });
  if (!io.native()) return refuse(CANVAS_LOAD_REFUSAL.notHere);
  const stat = await io.stat(fileId);
  if (!stat) return refuse(CANVAS_LOAD_REFUSAL.gone);
  if (stat.len > CANVAS_MAX_BYTES) return refuse(CANVAS_LOAD_REFUSAL.tooLarge);
  const parsed = parseCanvas(await io.text(fileId, stat.len));
  if (!parsed.ok) return refuse(parsed.error);
  return {
    state: { status: "ready", doc: parsed.doc, writable: stat.writable, saveError: null },
    revision: stat.revision,
  };
}

async function base64Of(text: string): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("couldn’t encode the canvas"));
    reader.readAsDataURL(new Blob([text], { type: "application/json" }));
  });
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

export function useCanvasFile(fileId: string): {
  state: CanvasFileState;
  change: (doc: CanvasDoc) => void;
} {
  const [state, setState] = useState<CanvasFileState>({ status: "loading" });
  const revision = useRef<string | null>(null);
  const pending = useRef<CanvasDoc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const doc = pending.current;
    if (!doc || revision.current === null) return;
    pending.current = null;
    try {
      revision.current = await corpusWriteFileBytes(
        fileId,
        await base64Of(serializeCanvas(doc)),
        false,
        revision.current,
      );
      setState((current) => (current.status === "ready" ? { ...current, saveError: null } : current));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((current) => (current.status === "ready" ? { ...current, saveError: message } : current));
    }
  }, [fileId]);

  useEffect(() => {
    // a different file remounts the host (keyed by fileId), so the first
    // state is always "loading" — no reset here
    let cancelled = false;
    loadCanvasFile(fileId)
      .then((loaded) => {
        if (cancelled) return;
        revision.current = loaded.revision;
        setState(loaded.state);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({ status: "error", error: err instanceof Error ? err.message : String(err) });
      });
    const unregister = onQuitFlush(flush);
    return () => {
      cancelled = true;
      unregister();
      void flush();
    };
  }, [fileId, flush]);

  const change = useCallback(
    (doc: CanvasDoc) => {
      setState((current) => (current.status === "ready" ? { ...current, doc } : current));
      if (state.status !== "ready" || !state.writable) return;
      pending.current = doc;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
    },
    [flush, state],
  );

  return { state, change };
}

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
