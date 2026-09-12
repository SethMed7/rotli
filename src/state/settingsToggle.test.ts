import { expect, test } from "bun:test";

import { toggleSettings } from "./settingsToggle";
import { useUiStore } from "./ui";

test("toggling Settings opens it over a clean workspace and closes it again", () => {
  useUiStore.setState({ settingsOpen: false, sidebarMode: "notes", paletteOpen: true, focusMode: true });
  toggleSettings(() => true);
  const opened = useUiStore.getState();
  expect(opened.settingsOpen).toBe(true);
  expect(opened.paletteOpen).toBe(false);
  expect(opened.focusMode).toBe(false);
  toggleSettings(() => true);
  expect(useUiStore.getState().settingsOpen).toBe(false);
});

test("an unsaved Breve draft asks first and a refusal keeps Settings closed", () => {
  useUiStore.setState({ settingsOpen: false, sidebarMode: "breve", breveDirty: true });
  toggleSettings(() => false);
  expect(useUiStore.getState().settingsOpen).toBe(false);
  expect(useUiStore.getState().breveDirty).toBe(true);
  toggleSettings(() => true);
  expect(useUiStore.getState().settingsOpen).toBe(true);
  expect(useUiStore.getState().breveDirty).toBe(false);
});
