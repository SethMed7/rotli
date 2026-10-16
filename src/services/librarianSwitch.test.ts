import { expect, test } from "bun:test";

import { useUiStore } from "../state/ui";
import { holdLibrarianOffInPlace, librarianAllowed, setLibrarianOn } from "./librarianSwitch";
import { setOpenedInPlace } from "./vaultInPlace";

test("one switch for the Librarian: Settings and setup's Not now both change the vault's setting", () => {
  setLibrarianOn(false);
  expect(useUiStore.getState().brainEnabled).toBe(false);
  setLibrarianOn(true);
  expect(useUiStore.getState().brainEnabled).toBe(true);
});

test("a folder connected in place keeps the Librarian off: no switch turns it on there", () => {
  setLibrarianOn(true);
  setOpenedInPlace(true);
  try {
    expect(librarianAllowed()).toBe(false);
    // a settings file that says on (a hand edit, or a setting from before) is held off
    holdLibrarianOffInPlace();
    expect(useUiStore.getState().brainEnabled).toBe(false);
    setLibrarianOn(true);
    expect(useUiStore.getState().brainEnabled).toBe(false);
  } finally {
    setOpenedInPlace(false);
  }
  setLibrarianOn(true);
  expect(useUiStore.getState().brainEnabled).toBe(true);
});
