import { expect, test } from "bun:test";

import { appExtrasSnapshot, hydrateAppExtras } from "./appExtras";
import { APP_SETTINGS_KEYS } from "./appSettingsKeys";
import { useHandToAiMode } from "./handToAiMode";

test("Hand to AI opens in Basic by default and remembers the mode in the app settings", () => {
  expect(APP_SETTINGS_KEYS.has("handToAiMode")).toBe(true);
  hydrateAppExtras("{}");
  expect(useHandToAiMode.getState().mode).toBe("basic");
  hydrateAppExtras(JSON.stringify({ handToAiMode: "refined" }));
  expect(useHandToAiMode.getState().mode).toBe("refined");
  expect(appExtrasSnapshot().handToAiMode).toBe("refined");
  hydrateAppExtras(JSON.stringify({ handToAiMode: "fancy" }));
  expect(useHandToAiMode.getState().mode).toBe("basic");
});
