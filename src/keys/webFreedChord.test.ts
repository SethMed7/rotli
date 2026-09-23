// Which chords Rotli Web hands to the browser instead of the editor: only the
// ones the Mac app would claim right now (review of #66).

import { afterEach, expect, test } from "bun:test";

import { attachDispatcher, registerAction, webFreedChord } from "./registry";

afterEach(() => {
  attachDispatcher("main")();
});

test("an always-on app chord is freed on the web, never in the Mac app", () => {
  registerAction({ id: "t.freedNav", title: "Nav", defaultChord: "Meta+F15", run: () => {} });
  expect(webFreedChord("Meta+F15", false)).toBe(true);
  expect(webFreedChord("Meta+F15", true)).toBe(false);
});

test("a chord the app claims only sometimes still reaches the editor when unclaimed", () => {
  let selection = false;
  registerAction({
    id: "t.freedWhenSelected",
    title: "Trash selection",
    defaultChord: "Meta+F16",
    enabled: () => selection,
    run: () => {},
  });
  expect(webFreedChord("Meta+F16", false)).toBe(false);
  selection = true;
  expect(webFreedChord("Meta+F16", false)).toBe(true);
});

test("a chord another window owns is not freed in this one", () => {
  registerAction({
    id: "t.freedChat",
    title: "Chat only",
    defaultChord: "Meta+F17",
    surface: "chat",
    run: () => {},
  });
  attachDispatcher("main");
  expect(webFreedChord("Meta+F17", false)).toBe(false);
});
