// The inline-mark chords: ⌘B ⌘I ⌘U ⌘⇧H shipped; ⌘E (inline code) and ⌘⇧X
// (strikethrough) join them so every format-bar mark has a keyboard path.
// None may collide with another registered action.

import { describe, expect, test } from "bun:test";

import { registerDefaultActions } from "./actions";
import { EDITOR_ACTION } from "./editorActionIds";
import { conflictFor, currentChord } from "./registry";

registerDefaultActions();

describe("inline mark chord defaults", () => {
  test("every chorded mark has its documented default", () => {
    expect(currentChord(EDITOR_ACTION.bold)).toBe("Meta+B");
    expect(currentChord(EDITOR_ACTION.italic)).toBe("Meta+I");
    expect(currentChord(EDITOR_ACTION.underline)).toBe("Meta+U");
    expect(currentChord(EDITOR_ACTION.highlight)).toBe("Meta+Shift+H");
    expect(currentChord(EDITOR_ACTION.code)).toBe("Meta+E");
    expect(currentChord(EDITOR_ACTION.strike)).toBe("Meta+Shift+X");
  });

  test("the new defaults collide with no other action, and ⌘K stays the palette", () => {
    expect(conflictFor(EDITOR_ACTION.code, "Meta+E")).toBeNull();
    expect(conflictFor(EDITOR_ACTION.strike, "Meta+Shift+X")).toBeNull();
    expect(currentChord("palette.toggle")).toBe("Meta+K");
  });
});
