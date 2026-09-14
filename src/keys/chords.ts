// One chord grammar everywhere. A chord is "Ctrl+Alt+Shift+Meta+Key" with the
// modifiers in that canonical order and the key taken from KeyboardEvent.code
// ("A".."Z", "0".."9", "Space", "Comma", "Enter", "Esc", "ArrowLeft", …).
// The dispatcher, the ⌘K kbd hints, and Settings → Hotkeys all speak it; the
// Rust side gets it translated through toAccelerator.

const MOD_ORDER = ["Ctrl", "Alt", "Shift", "Meta"] as const;
type Mod = (typeof MOD_ORDER)[number];

const PASSTHROUGH_CODES = new Set([
  "Space",
  "Tab",
  "Enter",
  "Comma",
  "Period",
  "Slash",
  "Backslash",
  "Backquote",
  "Minus",
  "Equal",
  "Semicolon",
  "Quote",
  "BracketLeft",
  "BracketRight",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Backspace",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/** event.code → our key token; null for modifiers / unmappable keys. */
export function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (code === "Escape") return "Esc";
  if (PASSTHROUGH_CODES.has(code) || /^F\d{1,2}$/.test(code)) return code;
  return null;
}

/** The chord a keydown represents, or null if only modifiers are down. */
export function chordFromEvent(event: KeyboardEvent): string | null {
  const key = keyFromCode(event.code);
  if (!key) return null;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Meta");
  parts.push(key);
  return parts.join("+");
}

/** Canonical modifier order + Esc spelling, so string equality = chord equality. */
export function normalizeChord(chord: string): string {
  const parts = chord.split("+");
  const last = parts[parts.length - 1] ?? "";
  const key = last === "Escape" ? "Esc" : last;
  const mods = new Set(parts.slice(0, -1) as Mod[]);
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].join("+");
}

// Display order follows the approved gate hints (⌥⌘F · ⌘⇧D): ⌃ ⌥ ⌘ ⇧.
const MOD_SYMBOLS: [Mod, string][] = [
  ["Ctrl", "⌃"],
  ["Alt", "⌥"],
  ["Meta", "⌘"],
  ["Shift", "⇧"],
];

const KEY_LABELS: Record<string, string> = {
  Enter: "⏎",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  BracketLeft: "[",
  BracketRight: "]",
  Backquote: "`",
  Minus: "−",
  Equal: "=",
  Semicolon: ";",
  Quote: "'",
  Backspace: "⌫",
  Delete: "⌦",
  Home: "↖",
  End: "↘",
  PageUp: "⇞",
  PageDown: "⇟",
  Tab: "⇥",
  Space: "Space",
};

/** "Alt+Meta+F" → "⌥⌘F" (mac symbols, the gates' hint voice). */
export function formatChord(chord: string): string {
  const parts = chord.split("+");
  const last = parts[parts.length - 1] ?? "";
  const key = last === "Escape" ? "Esc" : last;
  const mods = new Set(parts.slice(0, -1) as Mod[]);
  const prefix = MOD_SYMBOLS.filter(([m]) => mods.has(m))
    .map(([, s]) => s)
    .join("");
  return prefix + (KEY_LABELS[key] ?? key);
}

/** Our chord notation → a Tauri global-shortcut accelerator string. */
export function toAccelerator(chord: string): string {
  return chord
    .split("+")
    .map((part) =>
      part === "Meta" ? "Command" : part === "Esc" ? "Escape" : part === "Ctrl" ? "Control" : part,
    )
    .join("+");
}

/** "Italic" + "Meta+I" → "Italic — ⌘I"; an unbound action keeps its bare label,
 * so a control's tooltip always tells the truth after a rebind. */
export function withChordHint(label: string, chord: string | null): string {
  return chord ? `${label} — ${formatChord(chord)}` : label;
}
