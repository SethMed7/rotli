// The Canvas's save queue (audit 2026-10-06, P0). A canvas is saved a short
// beat after the last edit, and again on close and on quit. Three rules keep
// a person's work safe:
//
// - one write at a time, in order: a newer doc never lands before an older one;
// - the unsaved doc stays queued until ITS write succeeds, so a failure keeps
//   it for the next try, and quit fails loudly instead of believing it saved;
// - a revision conflict (the file changed on disk since it was read) stops
//   further edits rather than piling them up against a write that can't land.
//
// Pure apart from the injected write and timer, so the rules are unit-tested.

import { type CanvasDoc, serializeCanvas } from "./model";

/** The one wording for a canvas that changed under Rotli. */
export const CANVAS_CONFLICT =
  "This canvas changed on disk since it was opened. Reopen it to keep editing; your last changes weren’t saved.";

export function isRevisionConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /revision conflict|changed on disk/i.test(message);
}

export interface CanvasSaverOptions {
  revision: string;
  /** Write the text over `revision`; answers the new revision. */
  write: (text: string, revision: string) => Promise<string>;
  onSaved: () => void;
  onError: (message: string, conflicted: boolean) => void;
  delayMs: number;
  schedule?: (run: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export interface CanvasSaver {
  /** Queue `doc` to be saved after the beat. False once the canvas conflicted. */
  queue: (doc: CanvasDoc) => boolean;
  /** Save what is queued now, after any write already in flight. Rejects when
   * the write fails — the quit path relies on that. */
  flush: () => Promise<void>;
  readonly conflicted: boolean;
}

export function createCanvasSaver(options: CanvasSaverOptions): CanvasSaver {
  const schedule = options.schedule ?? ((run, ms) => setTimeout(run, ms));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let revision = options.revision;
  let pending: CanvasDoc | null = null;
  let timer: unknown = null;
  let conflicted = false;
  let chain: Promise<void> = Promise.resolve();

  const run = async () => {
    const doc = pending;
    if (!doc || conflicted) return;
    try {
      revision = await options.write(serializeCanvas(doc), revision);
      // a newer edit may have arrived meanwhile; it stays queued
      if (pending === doc) pending = null;
      options.onSaved();
    } catch (error) {
      if (isRevisionConflict(error)) conflicted = true;
      options.onError(
        conflicted ? CANVAS_CONFLICT : error instanceof Error ? error.message : String(error),
        conflicted,
      );
      throw error;
    }
  };

  const flush = () => {
    if (timer !== null) cancel(timer);
    timer = null;
    // after whatever is in flight, success or not
    const next = chain.then(run, run);
    chain = next.catch(() => {});
    return next;
  };

  return {
    queue(doc) {
      if (conflicted) return false;
      pending = doc;
      if (timer !== null) cancel(timer);
      timer = schedule(() => {
        timer = null;
        // a failure is already reported through onError
        flush().catch(() => {});
      }, options.delayMs);
      return true;
    },
    flush,
    get conflicted() {
      return conflicted;
    },
  };
}
