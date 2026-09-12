import { expect, test } from "bun:test";

import { DEFAULT_APPEARANCE } from "./appearanceDefaults";
import { resolveThemeSetting } from "./theme";
import { useUiStore } from "./ui";

test("the appearance default is Rotli Light and the store boots from it", () => {
  expect(DEFAULT_APPEARANCE).toMatchObject({ theme: "light", themeFamily: "warm", accentColor: "default" });
  // an explicit light setting never follows the OS, even on a dark Mac
  expect(resolveThemeSetting(DEFAULT_APPEARANCE.theme, DEFAULT_APPEARANCE.themeFamily, true)).toBe("light");
  const initial = useUiStore.getInitialState();
  expect(initial.theme).toBe(DEFAULT_APPEARANCE.theme);
  expect(initial.themeFamily).toBe(DEFAULT_APPEARANCE.themeFamily);
});
