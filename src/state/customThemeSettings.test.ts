import { expect, test } from "bun:test";

import { hydrateAppExtras } from "./appExtras";
import { APP_SETTINGS_KEYS } from "./appSettingsKeys";
import { useCustomTheme } from "./customTheme";
import { APP_SETTINGS_KEYS_1_9_6 } from "./release196.fixtures";

test("the custom theme setting is ours now, and was unknown to 1.9.6, which carries it through", () => {
  expect(APP_SETTINGS_KEYS.has("customTheme")).toBe(true);
  expect(APP_SETTINGS_KEYS_1_9_6).not.toContain("customTheme" as never);
});

test("the selection round-trips through the settings text; a damaged one reads as none", () => {
  const selection = { id: "forest-paper", name: "Forest Paper", source: "mac" };
  hydrateAppExtras(JSON.stringify({ customTheme: selection }));
  expect(useCustomTheme.getState().selection).toEqual(selection as never);
  for (const damaged of [{ id: "../x", source: "mac" }, "forest-paper", 42, null]) {
    hydrateAppExtras(JSON.stringify({ customTheme: damaged }));
    expect(useCustomTheme.getState().selection).toBeNull();
  }
});
