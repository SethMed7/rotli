import { expect, test } from "bun:test";

import { EDITOR_ACTION } from "./editorActionIds";
import { chordInBuild } from "./registry";

// neutral ids and chords: the rule is about the SHAPE of a binding, not any one action
const APP = "demo.appCommand";
const APP_CHORD = "Ctrl+Alt+F9";

test("Rotli Web withholds app modifier chords, keeps text formatting and bare keys", () => {
  // the Mac app: everything as bound
  expect(chordInBuild(APP_CHORD, APP, true)).toBe(APP_CHORD);
  // the web: an app chord belongs to the browser
  expect(chordInBuild(APP_CHORD, APP, false)).toBeNull();
  expect(chordInBuild("Meta+Shift+F9", APP, false)).toBeNull();
  // …but the editor's formatting keys still format, and bare keys still answer
  expect(chordInBuild("Meta+F9", EDITOR_ACTION.bold, false)).toBe("Meta+F9");
  expect(chordInBuild("F9", APP, false)).toBe("F9");
  expect(chordInBuild(null, APP, false)).toBeNull();
});
