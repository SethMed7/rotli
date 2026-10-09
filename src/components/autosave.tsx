// Sheets and DOCX documents save themselves (the owner, 2026-10-09: "I
// shouldn't have to hit cmd+s in order to save — that breaks the feeling of
// just working"). An edit arms one short timer; when it fires the editor's own
// save runs, never two at once, and edits made during a save run again after
// it. The header shows Saving… then Saved — a status, not a button. ⌘S still
// saves at once for people who reach for it. Parking on tab switch and the
// quit flush (registerLiveDirty) are unchanged: this only moves the moment.

import { useEffect, useState } from "react";

/** Long enough that typing across a row is one save, short enough that the
 * file is written before you look away. A workbook is heavier to encode than
 * a note or a board (500 ms), so a little longer. */
export const AUTOSAVE_AFTER_MS = 800;

export interface Autosave {
  /** An edit happened: (re)arm the timer. */
  edited: () => void;
  /** Save now (⌘S), cancelling the timer. */
  flush: () => void;
}

interface AutosaveTimer extends Autosave {
  setSave: (save: () => Promise<void>) => void;
  cancel: () => void;
}

/** The timer itself, framework-free: one pending timer, one save in flight,
 * and a rerun when edits land during a save. */
export function createAutosave(
  delayMs = AUTOSAVE_AFTER_MS,
  schedule: (run: () => void, ms: number) => () => void = (run, ms) => {
    const id = setTimeout(run, ms);
    return () => clearTimeout(id);
  },
): AutosaveTimer {
  let save: () => Promise<void> = async () => {};
  let clear: (() => void) | null = null;
  let inFlight = false;
  let again = false;
  const cancel = () => {
    clear?.();
    clear = null;
  };
  const run = async (): Promise<void> => {
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    try {
      await save();
    } catch {
      // the editor shows its own failure (Not saved + the reason); the next
      // edit tries again
    } finally {
      inFlight = false;
    }
    if (again) {
      again = false;
      await run();
    }
  };
  return {
    setSave: (next) => {
      save = next;
    },
    cancel,
    edited: () => {
      cancel();
      clear = schedule(() => {
        clear = null;
        void run();
      }, delayMs);
    },
    flush: () => {
      cancel();
      void run();
    },
  };
}

/** `save` resolves when the write settles; it reads its own latest state. An
 * unmount mid-wait leaves the edits to the park / quit-flush lane, as before. */
export function useAutosave(save: () => Promise<void>, delayMs = AUTOSAVE_AFTER_MS): Autosave {
  const [timer] = useState(() => createAutosave(delayMs));
  useEffect(() => {
    timer.setSave(save);
  });
  useEffect(() => () => timer.cancel(), [timer]);
  return timer;
}

/** Saving… while there are edits not yet on disk, Saved once there are none,
 * Not saved when the last write failed (the error itself sits beside it). The
 * slot keeps the width of its longest word, so nothing beside it moves. */
export function SaveStatus({ dirty, saving, failed }: { dirty: boolean; saving: boolean; failed: boolean }) {
  const label = failed ? "Not saved" : saving || dirty ? "Saving…" : "Saved";
  return (
    <span className="save-status" role="status" aria-live="polite">
      <span className="save-status-sizer" aria-hidden="true">
        Not saved
      </span>
      <span>{label}</span>
    </span>
  );
}
