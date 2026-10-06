import { expect, test } from "bun:test";

import { useUiStore } from "../../state/ui";
import { openLibrarianSettings } from "./useLibrarianSetup";

test("finishing opens Settings at the Librarian", () => {
  useUiStore.setState({ settingsOpen: false, settingsPaneRequest: null });
  openLibrarianSettings();
  expect(useUiStore.getState().settingsOpen).toBe(true);
  expect(useUiStore.getState().settingsPaneRequest).toBe("brain");
});
