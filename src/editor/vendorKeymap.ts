// The vendor (CodeMirror) keymaps minus every chord the key registry owns.
// CM binds ⌘I / ⌘U / ⌘[ / ⌘] / ⌘⏎ with preventDefault, and the registry
// dispatcher treats a consumed keydown as "not a chord press" — so an
// unfiltered vendor set silently eats editor.italic, editor.underline,
// nav.back, nav.forward and setup.continue. Policy lives here once: the
// registry's chords win; whatever CM binds on a free chord stays.

import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import type { KeyBinding } from "@codemirror/view";

import { allActions, currentChord } from "../keys/registry";

export const VENDOR_KEYMAP: readonly KeyBinding[] = [...defaultKeymap, ...historyKeymap];

/** Registry key tokens (KeyboardEvent.code names) → CodeMirror key names. */
const CM_KEY_NAME: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Slash: "/",
  Comma: ",",
  Period: ".",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  Esc: "Escape",
};

function canonical(mods: string[], key: string): string {
  const named = mods.map((m) =>
    m === "Mod" || m === "Cmd" || m === "Meta" ? "Meta" : m === "Control" ? "Ctrl" : m,
  );
  return [...new Set(named)]
    .sort()
    .concat(key.length === 1 ? key.toLowerCase() : key)
    .join("-");
}

/** "Meta+BracketLeft" → the canonical form a CM key spec compares against. */
function fromRegistryChord(chord: string): string {
  const parts = chord.split("+");
  const key = parts.pop() ?? "";
  return canonical(parts, CM_KEY_NAME[key] ?? key);
}

/** "Shift-Mod-u" (or a spec whose key is "-" itself) → canonical form; Mod = ⌘ on mac. */
function fromCmSpec(spec: string): string {
  const key = spec.endsWith("-") ? "-" : spec.slice(spec.lastIndexOf("-") + 1);
  const mods = spec.slice(0, spec.length - key.length - 1);
  return canonical(mods ? mods.split("-") : [], key);
}

function specOf(binding: KeyBinding): string | undefined {
  return binding.mac ?? binding.key;
}

/** Does this keymap bind `spec` (CM syntax, e.g. "Mod-i")? Test seam. */
export function bindsKey(bindings: readonly KeyBinding[], spec: string): boolean {
  const wanted = fromCmSpec(spec);
  return bindings.some((b) => {
    const s = specOf(b);
    return s !== undefined && fromCmSpec(s) === wanted;
  });
}

/** The vendor bindings with every registry-owned chord removed. */
export function filterVendorKeymap(
  bindings: readonly KeyBinding[],
  ownedChords: Iterable<string | null>,
): KeyBinding[] {
  const owned = new Set<string>();
  for (const chord of ownedChords) if (chord) owned.add(fromRegistryChord(chord));
  return bindings.filter((b) => {
    const s = specOf(b);
    return s === undefined || !owned.has(fromCmSpec(s));
  });
}

/** Every chord the registry currently owns in this webview (OS-global ones
 * never reach CM, so they are irrelevant here). */
export function registryOwnedChords(): (string | null)[] {
  return allActions()
    .filter((a) => !a.global)
    .map((a) => currentChord(a.id));
}

/** The vendor keymap the editor installs: stock CM minus the registry's chords. */
export function vendorKeymap(): KeyBinding[] {
  return filterVendorKeymap(VENDOR_KEYMAP, registryOwnedChords());
}
