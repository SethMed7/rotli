import { expect, test } from "bun:test";

import { useUiStore } from "../state/ui";
import { setLibrarianOn } from "./librarianSwitch";

test("one switch for the Librarian: Settings and setup's Not now both change the vault's setting", () => {
  setLibrarianOn(false);
  expect(useUiStore.getState().brainEnabled).toBe(false);
  setLibrarianOn(true);
  expect(useUiStore.getState().brainEnabled).toBe(true);
});
