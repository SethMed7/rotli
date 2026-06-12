// The single registry of every hotkey-driven action, and the ONE keydown
// dispatcher that routes to it (attached once in App.tsx). No ad-hoc keydown
// listeners anywhere else — text inputs may handle their own typing, but every
// command chord lives here, and every chord is rebindable. Global chords are
// registered with the OS in Rust; rebinding them goes through
// set_summon_shortcut.

import { setSummonShortcut } from "../lib/tauri";

export interface KeyAction {
  id: string;
  title: string;
  /** Chord like "Esc", "Alt+Space", "Meta+0", "Alt+Meta+L"; null = unbound. */
  chord: string | null;
  /** OS-wide shortcut, registered + handled in Rust — the dispatcher skips it. */
  global?: boolean;
  run: () => void;
}

const actions = new Map<string, KeyAction>();

export function registerAction(action: KeyAction): void {
  actions.set(action.id, action);
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

export async function rebind(actionId: string, chord: string | null): Promise<void> {
  const action = actions.get(actionId);
  if (!action) return;
  action.chord = chord;
  if (action.global && chord) await setSummonShortcut(toAccelerator(chord));
}

/** Our chord notation → a Tauri accelerator string. */
function toAccelerator(chord: string): string {
  return chord
    .split("+")
    .map((part) => (part === "Meta" ? "Command" : part === "Esc" ? "Escape" : part))
    .join("+");
}

function keyToCode(key: string): string {
  if (key === "Esc" || key === "Escape") return "Escape";
  if (key === "Space") return "Space";
  if (/^[a-zA-Z]$/.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return key;
}

function eventMatches(event: KeyboardEvent, chord: string): boolean {
  const parts = chord.split("+");
  const key = parts[parts.length - 1];
  if (!key) return false;
  const mods = new Set(parts.slice(0, -1).map((m) => m.toLowerCase()));
  return (
    event.metaKey === mods.has("meta") &&
    event.ctrlKey === mods.has("ctrl") &&
    event.altKey === mods.has("alt") &&
    event.shiftKey === mods.has("shift") &&
    event.code === keyToCode(key)
  );
}

let detach: (() => void) | null = null;

/** Attach the one dispatcher. Idempotent; returns the detach function. */
export function attachDispatcher(): () => void {
  if (detach) return detach;
  const onKeyDown = (event: KeyboardEvent) => {
    for (const action of actions.values()) {
      if (action.global || !action.chord) continue;
      if (eventMatches(event, action.chord)) {
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
