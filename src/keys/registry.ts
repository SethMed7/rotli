// The single registry of every hotkey-driven action, and the ONE keydown
// dispatcher per webview that routes to it (attached once in App.tsx). No
// ad-hoc keydown listeners anywhere else — text inputs may handle their own
// typing, but every command chord lives here, and every chord is rebindable
// (the overrides map lives in the bindings store; defaults live here).
// Global chords are registered with the OS in Rust; rebinding them round-trips
// through the set_summon_shortcut invoke.

import { emitRebind, setGlobalShortcut } from "../lib/tauri";
import { resolveChord, useBindingsStore } from "./bindings";
import { chordFromEvent, normalizeChord, toAccelerator } from "./chords";
import { leaderConsumes } from "./leader";

/** Which webview an action belongs to — the dispatcher only fires actions for
 * its own surface (global actions are handled OS-side in Rust and skipped).
 * "quick" is the floating Quick Note window. */
export type Surface = "main" | "capture" | "quick";

export interface KeyAction {
  id: string;
  title: string;
  /** Default chord like "Esc", "Alt+Space", "Meta+0"; null = unbound. */
  defaultChord: string | null;
  surface: Surface;
  /** OS-wide shortcut, registered + handled in Rust — the dispatcher skips it. */
  global?: boolean;
  /** Fires on EVERY surface's dispatcher — for actions tied to a per-webview
   * seam that exists wherever it's mounted (the editor.* format commands resolve
   * through activeEditor(), so they belong to the main AND quick windows). Like
   * global, a shared chord conflicts across surfaces. */
  shared?: boolean;
  /** Runtime availability for transient surfaces such as first-run setup. */
  enabled?: () => boolean;
  /** Registered for dispatch but omitted from Settings/⌘K/shortcut maps. */
  transient?: boolean;
  /** Stands down inside a text field even with a modifier held: ⌘← is
   * "line start" in an input and must stay so (the nav.*.arrow chords). */
  unlessEditable?: boolean;
  run: () => void;
}

type KeyActionInput = Omit<KeyAction, "surface"> & { surface?: Surface };

const actions = new Map<string, KeyAction>();

export function registerAction(action: KeyActionInput): void {
  actions.set(action.id, { surface: "main", ...action });
}

export function getAction(id: string): KeyAction | undefined {
  return actions.get(id);
}

export function allActions(): KeyAction[] {
  return [...actions.values()].filter((action) => !action.transient);
}

export function dispatch(actionId: string): void {
  actions.get(actionId)?.run();
}

/** The action's chord right now: override if one exists, else its default. */
export function currentChord(actionId: string): string | null {
  const action = actions.get(actionId);
  if (!action) return null;
  return resolveChord(useBindingsStore.getState().overrides, actionId, action.defaultChord);
}

/** The other action already holding `chord`, if any (for the quiet inline
 * conflict note in Settings → Hotkeys). Each webview runs its own dispatcher,
 * so chords only collide on the SAME surface — or when either side is
 * OS-global (a global chord fires everywhere). */
export function conflictFor(actionId: string, chord: string): KeyAction | null {
  const target = actions.get(actionId);
  if (!target) return null;
  const n = normalizeChord(chord);
  for (const action of actions.values()) {
    if (action.id === actionId) continue;
    // a shared or global chord fires everywhere, so it collides with any
    // surface; otherwise only same-surface chords can collide
    const spansAll = action.global || target.global || action.shared || target.shared;
    if (action.surface !== target.surface && !spansAll) continue;
    const c = currentChord(action.id);
    if (c && normalizeChord(c) === n) return action;
  }
  return null;
}

/** Rebind an action. For global actions the OS registration goes FIRST — only
 * a successful round-trip commits the override (otherwise the UI would show a
 * chord the OS never fires; Rust keeps the old chord registered on failure and
 * the rejection bubbles to the caller for the quiet inline note). `null`
 * unbinds — including OS-side for global actions. */
export async function rebind(actionId: string, chord: string | null): Promise<void> {
  const action = actions.get(actionId);
  if (!action) return;
  if (action.global) await setGlobalShortcut(actionId, chord ? toAccelerator(chord) : null);
  useBindingsStore.getState().setOverride(actionId, chord);
  emitRebind(actionId, chord);
}

/** Apply a rebind that arrived from the other webview (no re-emit, no invoke). */
export function applyRebind(actionId: string, chord: string | null): void {
  useBindingsStore.getState().setOverride(actionId, chord);
}

let detach: (() => void) | null = null;
let attachedSurface: Surface = "main";

let suspended = false;

/** While Settings → Hotkeys records a chord the dispatcher stands down, so a
 * half-recorded combo can never fire a live action under the recorder. */
export function setDispatchSuspended(on: boolean): void {
  suspended = on;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

/** The chords Excalidraw owns on its own canvas (boards slice 2026-07-28):
 * ⌘D duplicated an object AND split the pane; ⌘0 reset canvas zoom AND toggled
 * the sidebar; ⌘=/⌘− were dead keys over a board (the app's contextual zoom
 * no-ops on canvas tabs). Inside a board, the canvas vocabulary wins — "zoom
 * where I am" is the house rule. Tab/app chords (⌘W, ⌘T, ⌘1-9…) still pass. */
const CANVAS_OWNED_CHORDS = new Set(["Meta+D", "Meta+Shift+D", "Meta+0", "Meta+Equal", "Meta+Minus"]);

function isCanvasTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && target.closest(".canvas-surface, .rotli-embed-board-inner") !== null
  );
}

/** The action this webview's dispatcher would fire for `pressed` (a normalized
 * chord) right now, or null. The one ownership rule: the dispatcher uses it, and
 * the editor's vendor keymap asks it before running a CodeMirror command on the
 * same chord (src/editor/vendorKeymap.ts). */
export function claimingAction(pressed: string): KeyAction | null {
  if (suspended) return null;
  for (const action of actions.values()) {
    if (action.global) continue; // OS-side, handled in Rust
    if (!action.shared && action.surface !== attachedSurface) continue;
    if (action.enabled && !action.enabled()) continue;
    const chord = currentChord(action.id);
    if (chord && normalizeChord(chord) === pressed) return action;
  }
  return null;
}

/** Attach the one dispatcher for this webview's surface. Idempotent. */
export function attachDispatcher(surface: Surface): () => void {
  if (detach) return detach;
  attachedSurface = surface;
  const onKeyDown = (event: KeyboardEvent) => {
    if (suspended) return;
    // a key the editor already consumed (a picker's Escape, a keymap binding)
    // is not a chord press: Esc must unwind the picker, not hide the window
    if (event.defaultPrevented) return;
    if (event.repeat) return; // auto-repeat is not a fresh press — never re-fire a command
    const pressed = chordFromEvent(event);
    if (!pressed) return;
    // a modifier-less chord must never swallow typing: inside editable targets
    // only Esc / Enter / F-keys may dispatch bare (the capture card's ⏎ save,
    // Esc everywhere) — a bare-letter rebind stays typable in text fields
    if (!(event.ctrlKey || event.altKey || event.metaKey) && isEditableTarget(event.target)) {
      const key = pressed.split("+").pop() ?? "";
      if (!/^(Esc|Enter|F\d{1,2})$/.test(key)) return;
    }
    // a pending two-step hotkey (keys/leader.ts) is offered the key before any
    // action: for that one keystroke ⌘1–9 mean "slot 1–9", not a tab jump.
    // AFTER the typing guard above, so a bare digit typed into the editor or a
    // filter while a leader is pending is still just a digit.
    if (leaderConsumes(pressed)) {
      event.preventDefault();
      return;
    }
    // over an Excalidraw canvas the clash chords belong to the canvas
    if (CANVAS_OWNED_CHORDS.has(pressed) && isCanvasTarget(event.target)) return;
    const action = claimingAction(pressed);
    if (action) {
      if (action.unlessEditable && isEditableTarget(event.target)) return;
      event.preventDefault();
      action.run();
    }
  };
  window.addEventListener("keydown", onKeyDown);
  detach = () => {
    window.removeEventListener("keydown", onKeyDown);
    detach = null;
  };
  return detach;
}
