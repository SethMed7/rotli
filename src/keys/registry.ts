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

/** Which webview an action belongs to — the dispatcher only fires actions for
 * its own surface (global actions are handled OS-side in Rust and skipped). */
export type Surface = "main" | "capture";

export interface KeyAction {
  id: string;
  title: string;
  /** Default chord like "Esc", "Alt+Space", "Meta+0"; null = unbound. */
  defaultChord: string | null;
  surface: Surface;
  /** OS-wide shortcut, registered + handled in Rust — the dispatcher skips it. */
  global?: boolean;
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
  return [...actions.values()];
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
 * conflict note in Settings → Hotkeys). */
export function conflictFor(actionId: string, chord: string): KeyAction | null {
  const n = normalizeChord(chord);
  for (const action of actions.values()) {
    if (action.id === actionId) continue;
    const c = currentChord(action.id);
    if (c && normalizeChord(c) === n) return action;
  }
  return null;
}

/** Rebind an action. Updates the bindings store, mirrors to the other webview,
 * and round-trips global chords through Rust so the OS registration follows. */
export async function rebind(actionId: string, chord: string | null): Promise<void> {
  const action = actions.get(actionId);
  if (!action) return;
  useBindingsStore.getState().setOverride(actionId, chord);
  emitRebind(actionId, chord);
  if (action.global && chord) await setGlobalShortcut(actionId, toAccelerator(chord));
}

/** Apply a rebind that arrived from the other webview (no re-emit, no invoke). */
export function applyRebind(actionId: string, chord: string | null): void {
  useBindingsStore.getState().setOverride(actionId, chord);
}

let detach: (() => void) | null = null;

/** Attach the one dispatcher for this webview's surface. Idempotent. */
export function attachDispatcher(surface: Surface): () => void {
  if (detach) return detach;
  const onKeyDown = (event: KeyboardEvent) => {
    const pressed = chordFromEvent(event);
    if (!pressed) return;
    for (const action of actions.values()) {
      if (action.global || action.surface !== surface) continue;
      const chord = currentChord(action.id);
      if (chord && normalizeChord(chord) === pressed) {
        event.preventDefault();
        action.run();
        return;
      }
    }
  };
  window.addEventListener("keydown", onKeyDown);
  detach = () => {
    window.removeEventListener("keydown", onKeyDown);
    detach = null;
  };
  return detach;
}
