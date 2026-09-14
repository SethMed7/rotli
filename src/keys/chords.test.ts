// One chord grammar everywhere: "Ctrl+Alt+Shift+Meta+Key" in canonical order,
// key tokens from KeyboardEvent.code. These lock the parse/normalize/format/
// accelerator round-trips the dispatcher, the ⌘K hints, and Settings → Hotkeys
// all depend on.

import { describe, expect, test } from "bun:test";

import {
  chordFromEvent,
  formatChord,
  keyFromCode,
  normalizeChord,
  toAccelerator,
  withChordHint,
} from "./chords";

// A minimal KeyboardEvent stand-in — chordFromEvent only reads .code and the
// four modifier booleans, never any DOM behaviour.
function evt(
  code: string,
  mods: Partial<Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">> = {},
): KeyboardEvent {
  return {
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods,
  } as KeyboardEvent;
}

describe("chordFromEvent", () => {
  test("reads modifiers and code only — the same chord on macOS and Linux", () => {
    // Linux Chromium sets metaKey for a Meta press just like macOS does; the
    // parser never consults navigator.platform, which is why ⌘ chords in
    // e2e/ run unchanged on ubuntu CI (CodeMirror's mac-only keymap does not)
    expect(chordFromEvent(evt("KeyT", { metaKey: true }))).toBe("Meta+T");
    expect(chordFromEvent(evt("KeyB", { metaKey: true, shiftKey: true }))).toBe("Shift+Meta+B");
    expect(chordFromEvent(evt("Backspace", { metaKey: true }))).toBe("Meta+Backspace");
    expect(chordFromEvent(evt("Unidentified", { metaKey: true }))).toBeNull();
  });
});

describe("keyFromCode", () => {
  test("maps letter and digit codes to bare tokens", () => {
    expect(keyFromCode("KeyA")).toBe("A");
    expect(keyFromCode("KeyZ")).toBe("Z");
    expect(keyFromCode("Digit0")).toBe("0");
    expect(keyFromCode("Digit9")).toBe("9");
  });

  test("spells Escape as Esc and keeps passthrough/function codes", () => {
    expect(keyFromCode("Escape")).toBe("Esc");
    expect(keyFromCode("Space")).toBe("Space");
    expect(keyFromCode("Comma")).toBe("Comma");
    expect(keyFromCode("ArrowLeft")).toBe("ArrowLeft");
    expect(keyFromCode("F5")).toBe("F5");
    expect(keyFromCode("F12")).toBe("F12");
  });

  test("returns null for modifier-only / unmappable codes", () => {
    expect(keyFromCode("ShiftLeft")).toBeNull();
    expect(keyFromCode("MetaRight")).toBeNull();
    expect(keyFromCode("Unknown")).toBeNull();
  });
});

describe("chordFromEvent", () => {
  test("emits modifiers in canonical Ctrl→Alt→Shift→Meta order", () => {
    expect(chordFromEvent(evt("KeyF", { metaKey: true, altKey: true }))).toBe("Alt+Meta+F");
    expect(chordFromEvent(evt("KeyK", { ctrlKey: true, altKey: true, shiftKey: true, metaKey: true }))).toBe(
      "Ctrl+Alt+Shift+Meta+K",
    );
  });

  test("is null when only modifiers are down", () => {
    expect(chordFromEvent(evt("ShiftLeft", { shiftKey: true }))).toBeNull();
  });

  test("handles a bare key with no modifiers", () => {
    expect(chordFromEvent(evt("Slash"))).toBe("Slash");
  });
});

describe("normalizeChord", () => {
  test("reorders modifiers into the canonical order", () => {
    expect(normalizeChord("Meta+Shift+Alt+Ctrl+F")).toBe("Ctrl+Alt+Shift+Meta+F");
  });

  test("rewrites a trailing Escape to Esc", () => {
    expect(normalizeChord("Meta+Escape")).toBe("Meta+Esc");
  });

  test("is idempotent (string equality == chord equality)", () => {
    const once = normalizeChord("Shift+Ctrl+Meta+ArrowUp");
    expect(normalizeChord(once)).toBe(once);
  });
});

describe("formatChord", () => {
  test("renders mac symbols in the gate display order ⌃⌥⌘⇧", () => {
    expect(formatChord("Alt+Meta+F")).toBe("⌥⌘F");
    expect(formatChord("Meta+Shift+D")).toBe("⌘⇧D");
    expect(formatChord("Ctrl+Alt+Meta+Shift+K")).toBe("⌃⌥⌘⇧K");
  });

  test("labels special keys and leaves bare keys alone", () => {
    expect(formatChord("Meta+Enter")).toBe("⌘⏎");
    expect(formatChord("Meta+ArrowLeft")).toBe("⌘←");
    expect(formatChord("Slash")).toBe("/");
    expect(formatChord("Meta+Comma")).toBe("⌘,");
  });
});

describe("toAccelerator", () => {
  test("translates our notation to the Tauri global-shortcut string", () => {
    expect(toAccelerator("Alt+Meta+F")).toBe("Alt+Command+F");
    expect(toAccelerator("Ctrl+Esc")).toBe("Control+Escape");
    expect(toAccelerator("Shift+A")).toBe("Shift+A");
  });
});

describe("round-trips", () => {
  test("normalize is stable across already-canonical chords", () => {
    // canonical order is Ctrl→Alt→Shift→Meta — so ⌘⇧D is "Shift+Meta+D", the
    // exact shape chordFromEvent emits. Normalizing a canonical chord is a
    // no-op: the property the dispatcher relies on for string equality.
    for (const chord of ["Alt+Meta+F", "Shift+Meta+D", "Ctrl+Alt+Shift+Meta+K", "Slash"]) {
      expect(normalizeChord(chord)).toBe(chord);
    }
  });

  test("event → chord → format is the displayed hint", () => {
    const chord = chordFromEvent(evt("KeyF", { altKey: true, metaKey: true }));
    expect(chord).toBe("Alt+Meta+F");
    expect(formatChord(chord!)).toBe("⌥⌘F");
  });
});

describe("withChordHint", () => {
  test("appends the current chord in the mac hint voice", () => {
    expect(withChordHint("Heading", "Meta+J")).toBe("Heading — ⌘J");
    expect(withChordHint("Reveal", "Alt+Shift+Meta+Period")).toBe("Reveal — ⌥⌘⇧.");
  });

  test("an unbound action shows its bare label, never a stale chord", () => {
    expect(withChordHint("Quote", null)).toBe("Quote");
  });
});
