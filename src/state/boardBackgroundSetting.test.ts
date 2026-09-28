import { describe, expect, test } from "bun:test";

import { APP_SETTINGS_KEYS } from "./appSettingsKeys";
import { parseSettings } from "./persist";

// 2026-09-27: Settings → Appearance → Board background.
describe("board background setting", () => {
  test("defaults to Match theme, keeps White, and rejects anything else", () => {
    expect(parseSettings("{}").boardBackground).toBe("theme");
    expect(parseSettings('{"boardBackground":"white"}').boardBackground).toBe("white");
    expect(parseSettings('{"boardBackground":"neon"}').boardBackground).toBe("theme");
  });

  test("is an app-wide setting like the theme", () => {
    expect(APP_SETTINGS_KEYS.has("boardBackground")).toBe(true);
  });
});
