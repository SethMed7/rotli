// The inline-mark chords: ⌘B ⌘I ⌘U ⌘⇧H shipped; ⌘E (inline code) and ⌘⇧X
// (strikethrough) join them so every format-bar mark has a keyboard path.
// None may collide with another registered action. Asserted in the display
// voice the tooltips and Settings → Hotkeys show.

import { describe, expect, test } from "bun:test";

import { registerDefaultActions } from "./actions";
import { formatChord } from "./chords";
import { EDITOR_ACTION } from "./editorActionIds";
import { conflictFor, currentChord } from "./registry";

registerDefaultActions();

const shown = (actionId: string): string | null => {
  const chord = currentChord(actionId);
  return chord ? formatChord(chord) : null;
};

describe("inline mark chord defaults", () => {
  test("every chorded mark has its documented default", () => {
    expect(
      [EDITOR_ACTION.bold, EDITOR_ACTION.italic, EDITOR_ACTION.underline, EDITOR_ACTION.highlight].map(shown),
    ).toEqual(["⌘B", "⌘I", "⌘U", "⌘⇧H"]);
    expect(shown(EDITOR_ACTION.code)).toBe("⌘E");
    expect(shown(EDITOR_ACTION.strike)).toBe("⌘⇧X");
  });

  test("the new defaults collide with no other action, and ⌘K stays the palette", () => {
    for (const id of [EDITOR_ACTION.code, EDITOR_ACTION.strike]) {
      expect(conflictFor(id, currentChord(id) ?? "")).toBeNull();
    }
    expect(shown("palette.toggle")).toBe("⌘K");
  });
});
