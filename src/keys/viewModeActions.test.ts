import { expect, test } from "bun:test";

import { useUiStore } from "../state/ui";
import { getAction } from "./registry";
import { registerViewModeActions } from "./viewModeActions";

registerViewModeActions();

test("reading mode rides on focus mode, so leaving focus (Esc, ⌥⌘F) leaves reading too", () => {
  const ui = () => useUiStore.getState();
  getAction("view.reading")?.run();
  expect(ui().readingMode).toBe(true);
  expect(ui().focusMode).toBe(true);
  ui().setFocusMode(false);
  expect(ui().readingMode).toBe(false);

  // ⌥⌘R toggles reading off again, chrome and all
  getAction("view.reading")?.run();
  getAction("view.reading")?.run();
  expect(ui().readingMode).toBe(false);
  expect(ui().focusMode).toBe(false);

  // plain focus mode never turns reading on
  getAction("view.focus")?.run();
  expect(ui().focusMode).toBe(true);
  expect(ui().readingMode).toBe(false);
  ui().setFocusMode(false);
});

test("reading mode has its own rebindable chord", () => {
  expect(getAction("view.reading")?.defaultChord).toBe("Alt+Meta+R");
  expect(getAction("view.focus")?.defaultChord).toBe("Alt+Meta+F");
});
