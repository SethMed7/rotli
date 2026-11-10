// Tab close/switch presentation must not join and write a large note during
// React's unmount commit. Keep the existing debounce/quit safety intact, but
// advance its save after the closing tab has reached a paint boundary.

import { flushNote, saveState } from "./model";

type AfterPaintScheduler = (task: () => void) => void;

function scheduleAfterNextPaint(task: () => void): void {
  // A hidden document will not reliably receive animation frames. It already
  // has the visibility flush safety net in the model; a task turn is the
  // non-blocking fallback for tests and non-visual runtimes.
  if (document.hidden || typeof requestAnimationFrame !== "function") {
    setTimeout(task, 0);
    return;
  }
  requestAnimationFrame(() => setTimeout(task, 0));
}

export function flushNoteAfterPaint(
  noteId: string,
  schedule: AfterPaintScheduler = scheduleAfterNextPaint,
): void {
  if (!saveState(noteId).pending) return;
  // a failed save stays on the editor's save dot; nothing awaits it here
  schedule(() => void flushNote(noteId).catch(() => {}));
}
