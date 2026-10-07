// Wires a `.canvas` file to the Canvas editor — on the Mac app or a connected
// Rotli Web folder (services/canvasFiles.ts picks): read the file,
// parse it, and save edits back through canvasSaver.ts (debounced, one write
// at a time, revision-checked — a canvas changed on disk since it was read
// stops taking edits instead of overwriting). Note cards resolve in
// canvasNotes.ts.

import { useCallback, useEffect, useRef, useState } from "react";

import { onQuitFlush } from "../lib/quitFlush";
import { type CanvasFileIo, canvasFileIo } from "../services/canvasFiles";
import { type CanvasSaver, createCanvasSaver } from "./canvasSaver";
import { type CanvasDoc, parseCanvas } from "./model";

export type CanvasFileState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; doc: CanvasDoc; writable: boolean; saveError: string | null };

const SAVE_AFTER_MS = 500;
/** Bigger than any canvas a person draws; past it Rotli refuses rather than
 * open half a file. */
export const CANVAS_MAX_BYTES = 8_000_000;

/** Why a canvas file didn't open — one wording, shared with the tests. */
export const CANVAS_LOAD_REFUSAL = {
  notHere: "Canvases need a vault folder — connect one to open this canvas.",
  unsaved:
    "Your last changes to this canvas haven’t saved yet, so it won’t open over them. Rotli tries again when you reopen it and when you quit.",
  gone: "This canvas isn’t in the vault anymore.",
  tooLarge: "This canvas is too large to open.",
} as const;

/** Read and parse a canvas, failing closed: with nowhere to hold a canvas it
 * refuses instead of showing a blank one; the whole file is read (a default
 * read cap would cut it short), and one too large to read is refused. */
export async function loadCanvasFile(
  fileId: string,
  io: CanvasFileIo | null = canvasFileIo(),
): Promise<{ state: CanvasFileState; revision: string | null }> {
  const refuse = (error: string) => ({ state: { status: "error", error } as const, revision: null });
  if (!io) return refuse(CANVAS_LOAD_REFUSAL.notHere);
  const stat = await io.stat(fileId);
  if (!stat) return refuse(CANVAS_LOAD_REFUSAL.gone);
  if (stat.len > CANVAS_MAX_BYTES) return refuse(CANVAS_LOAD_REFUSAL.tooLarge);
  const text = await io.read(fileId, stat.len);
  // a file that went away between the look and the read is gone, never empty
  if (text === null) return refuse(CANVAS_LOAD_REFUSAL.gone);
  const parsed = parseCanvas(text);
  if (!parsed.ok) return refuse(parsed.error);
  return {
    state: { status: "ready", doc: parsed.doc, writable: stat.writable, saveError: null },
    revision: stat.revision,
  };
}

/** Saves that failed as their tab closed, by file. Quit retries each one;
 * reopening the file retries it first, so one file never has two savers
 * racing at quit (ROTLI re-review, PR 173). */
const unsaved = new Map<string, { flush: () => Promise<void>; unregister: () => void }>();

/** A canvas tab closing saves now. A save that fails stays registered for
 * quit, which retries it and stops if it still can't land — closing a tab
 * never drops an edit quietly. */
export function closeCanvasSaver(
  fileId: string,
  saver: CanvasSaver | null,
  unregister: () => void,
): Promise<void> {
  if (!saver) {
    unregister();
    return Promise.resolve();
  }
  return saver.flush().then(unregister, () => {
    unsaved.set(fileId, { flush: () => saver.flush(), unregister });
  });
}

/** Before a canvas opens, land the save its last tab couldn't. Rejects while
 * it still can't, so the canvas never opens over an edit it hasn't kept. */
export async function settleUnsavedCanvas(fileId: string): Promise<void> {
  const left = unsaved.get(fileId);
  if (!left) return;
  await left.flush();
  left.unregister();
  unsaved.delete(fileId);
}

export function useCanvasFile(fileId: string): {
  state: CanvasFileState;
  change: (doc: CanvasDoc) => void;
} {
  const [state, setState] = useState<CanvasFileState>({ status: "loading" });
  const saver = useRef<CanvasSaver | null>(null);

  useEffect(() => {
    // a different file remounts the host (keyed by fileId), so the first
    // state is always "loading" — no reset here
    let cancelled = false;
    let unregister = () => {};
    const io = canvasFileIo();
    settleUnsavedCanvas(fileId)
      .then(
        () => loadCanvasFile(fileId, io),
        (err: unknown) => {
          const reason = err instanceof Error ? err.message : String(err);
          return {
            state: { status: "error", error: `${CANVAS_LOAD_REFUSAL.unsaved} (${reason})` } as const,
            revision: null,
          };
        },
      )
      .then((loaded) => {
        if (cancelled) return;
        if (io && loaded.revision !== null) {
          const ready = (patch: Partial<Extract<CanvasFileState, { status: "ready" }>>) =>
            setState((current) => (current.status === "ready" ? { ...current, ...patch } : current));
          const created = createCanvasSaver({
            revision: loaded.revision,
            delayMs: SAVE_AFTER_MS,
            write: (text, revision) => io.write(fileId, text, revision),
            onSaved: () => ready({ saveError: null }),
            // a conflict ends editing: the file on disk is newer than this view
            onError: (message, conflicted) =>
              ready(conflicted ? { saveError: message, writable: false } : { saveError: message }),
          });
          saver.current = created;
          // quit waits for the save and stops if it fails
          unregister = onQuitFlush(() => created.flush());
        }
        setState(loaded.state);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setState({ status: "error", error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
      void closeCanvasSaver(fileId, saver.current, unregister);
      saver.current = null;
    };
  }, [fileId]);

  const change = useCallback(
    (doc: CanvasDoc) => {
      // a read-only canvas, or one that conflicted, takes no edits at all
      if (state.status !== "ready" || !state.writable) return;
      if (!saver.current?.queue(doc)) return;
      setState((current) => (current.status === "ready" ? { ...current, doc } : current));
    },
    [state],
  );

  return { state, change };
}
