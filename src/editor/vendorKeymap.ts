// The vendor (CodeMirror) keymaps, taught to yield to the key registry.
// CM binds ⌘I / ⌘U / ⌘[ / ⌘] / ⌘⌥↑↓ with preventDefault, and the registry
// dispatcher treats a consumed keydown as "not a chord press" — so the stock
// keymaps silently ate editor.italic, editor.underline, nav.back, nav.forward
// and the pane-focus chords (0.95.0). Removing those bindings outright would be
// wrong too: ⌘⌫ belongs to the System browser's trash only while a System
// selection exists, and ⌘⏎ to the capture window, so a note must keep CM's
// delete-to-line-start and insert-blank-line. Ownership is therefore decided
// at press time by the registry's own claim rule: when a registry action
// claims the chord it runs (and the keydown is consumed once); otherwise the
// CodeMirror command runs as before.

import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import type { Command, KeyBinding } from "@codemirror/view";

import { claimingAction, webFreedChord } from "../keys/registry";

export const VENDOR_KEYMAP: readonly KeyBinding[] = [...defaultKeymap, ...historyKeymap];

/** Something that may take over a chord right now; returns true when it did. */
export type ChordClaim = (chord: string) => boolean;

/** CodeMirror key names → registry key tokens (KeyboardEvent.code names). */
const REGISTRY_KEY: Record<string, string> = {
  "[": "BracketLeft",
  "]": "BracketRight",
  "\\": "Backslash",
  "/": "Slash",
  ",": "Comma",
  ".": "Period",
  ";": "Semicolon",
  "'": "Quote",
  "`": "Backquote",
  "-": "Minus",
  "=": "Equal",
  Escape: "Esc",
};

const MOD_ORDER = ["Ctrl", "Alt", "Shift", "Meta"];
const MOD_NAME: Record<string, string> = {
  Mod: "Meta",
  Cmd: "Meta",
  Meta: "Meta",
  Ctrl: "Ctrl",
  Control: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
};

/** "Shift-Mod-u" → "Shift+Meta+U" (mac: Mod = ⌘); null for a modifier-less
 * spec — bare keys (Escape, Enter, arrows) stay CodeMirror-first. */
export function registryChordOf(spec: string, addShift = false): string | null {
  const key = spec.endsWith("-") ? "-" : spec.slice(spec.lastIndexOf("-") + 1);
  const modText = spec.slice(0, Math.max(0, spec.length - key.length - 1));
  const mods = new Set((modText ? modText.split("-") : []).map((m) => MOD_NAME[m] ?? m));
  if (addShift) mods.add("Shift");
  if (!mods.has("Meta") && !mods.has("Ctrl") && !mods.has("Alt")) return null;
  const token = REGISTRY_KEY[key] ?? (key.length === 1 ? key.toUpperCase() : key);
  return [...MOD_ORDER.filter((m) => mods.has(m)), token].join("+");
}

function yielding(
  chord: string | null,
  command: Command,
  claim: ChordClaim,
  freed: (chord: string) => boolean,
): Command {
  if (!chord) return command;
  // a chord the app reserves but this build leaves to the browser (Rotli Web):
  // not handled here either, so the browser's own shortcut runs
  return (view) => claim(chord) || (!freed(chord) && command(view));
}

/** Every binding with a modifier chord asks `claim` first, for both its plain
 * and Shift variants, and skips a chord `freed` leaves to the browser. Pure
 * given `claim` and `freed` — the unit-test seam. */
export function yieldToRegistry(
  bindings: readonly KeyBinding[],
  claim: ChordClaim,
  freed: (chord: string) => boolean = () => false,
): KeyBinding[] {
  return bindings.map((binding) => {
    const spec = binding.mac ?? binding.key;
    if (!spec) return binding;
    const next: KeyBinding = { ...binding };
    if (binding.run) next.run = yielding(registryChordOf(spec), binding.run, claim, freed);
    if (binding.shift) next.shift = yielding(registryChordOf(spec, true), binding.shift, claim, freed);
    return next;
  });
}

/** The registry's claim: run the action this webview's dispatcher would fire. */
export const registryClaim: ChordClaim = (chord) => {
  const action = claimingAction(chord);
  if (!action) return false;
  action.run();
  return true;
};

/** The vendor keymap the editor installs. */
export function vendorKeymap(): KeyBinding[] {
  return yieldToRegistry(VENDOR_KEYMAP, registryClaim, webFreedChord);
}
