// The Mac Edit menu's Undo / Redo for Univer, in Word documents and sheets
// alike. AppKit owns the Edit menu's key equivalents before the web view sees
// a keydown (native check, 2026-09-15), and WebKit turns the menu's undo: and
// redo: into a beforeinput (historyUndo / historyRedo) on the focused element —
// Univer's hidden text input, which has no history of its own. Those are
// answered here with Univer's own undo and redo.
//
// ⌘Z / ⇧⌘Z reach the page as key presses since 2026-10-09 (the Edit menu's
// Undo/Redo carry no keys; src-tauri lib.rs). Univer's own shortcuts run first
// (a window capture listener), but it answers ⌘Z only while its editor context
// says so — not while a sheet cell is merely selected — and binds redo only as
// ⌘Y. What it leaves arrives here not defaultPrevented and is answered before
// the browser's default undo can act on the hidden input.

import { isRedoChord, isUndoChord } from "./historyChords";

export type HistoryStep = "undo" | "redo";

/** A command Univer just ran from its own keydown must not run again when the
 * menu's beforeinput (or selectstart) for the same press follows it. */
export const MENU_DEDUPE_MS = 300;

export function isMacPlatform(): boolean {
  return /Mac/.test(navigator.platform || navigator.userAgent);
}

/** The history step a beforeinput asks for, or null for any other input. */
export function historyInputStep(inputType: string): HistoryStep | null {
  if (inputType === "historyUndo") return "undo";
  return inputType === "historyRedo" ? "redo" : null;
}

/** The history step a key press asks for, or null for any other chord. */
export function historyChordStep(
  event: Parameters<typeof isUndoChord>[0],
  isMac: boolean,
): HistoryStep | null {
  if (isUndoChord(event, isMac)) return "undo";
  return isRedoChord(event, isMac) ? "redo" : null;
}

/** When each Univer command last ran, so a menu echo of it can stand down. */
export function menuDedupe(now: () => number = () => performance.now()): {
  ran(id: string): void;
  due(id: string): boolean;
} {
  const lastRun = new Map<string, number>();
  return {
    ran: (id) => lastRun.set(id, now()),
    due: (id) => now() - (lastRun.get(id) ?? -Infinity) >= MENU_DEDUPE_MS,
  };
}

export interface UniverEditMenuOptions {
  /** The editor's document; the menu's beforeinput is heard on it. */
  view: Document;
  /** Where the keydown listener sits (capture), relative to Univer's own;
   * none (a document without a window) leaves key presses alone. */
  keyTarget: EventTarget | null;
  /** Whether the editor — not a toolbar field or other text box — has focus. */
  owns: () => boolean;
  /** A step the menu asked for (beforeinput); the caller dedupes. */
  fromMenu: (step: HistoryStep) => void;
  /** A step a key press asked for that Univer left unhandled. */
  fromKey: (step: HistoryStep) => void;
}

/** Route the Edit menu's and the keyboard's undo / redo to Univer. Returns the
 * release function. */
export function installUniverEditMenu({
  view,
  keyTarget,
  owns,
  fromMenu,
  fromKey,
}: UniverEditMenuOptions): () => void {
  const isMac = isMacPlatform();
  const onBeforeInput = (event: Event) => {
    const step = historyInputStep((event as InputEvent).inputType);
    if (!step || !owns()) return;
    event.preventDefault();
    fromMenu(step);
  };
  const onKeyDown = (event: Event) => {
    if (event.defaultPrevented || !owns()) return;
    const step = historyChordStep(event as KeyboardEvent, isMac);
    if (!step) return;
    event.preventDefault();
    fromKey(step);
  };
  view.addEventListener("beforeinput", onBeforeInput, true);
  keyTarget?.addEventListener("keydown", onKeyDown, true);
  return () => {
    view.removeEventListener("beforeinput", onBeforeInput, true);
    keyTarget?.removeEventListener("keydown", onKeyDown, true);
  };
}
