import { expect, test } from "bun:test";

import { CLAUDE_FM, DEFAULT_AMBIENT } from "../../lib/ambient";
import { setupSoundChange, setupSoundChoice } from "./setupSound";

test("the Sound step reads the saved preference as one of three choices", () => {
  expect(setupSoundChoice(DEFAULT_AMBIENT)).toBe("off");
  expect(setupSoundChoice({ enabled: true, playing: true, track: "tide", volume: 0.4 })).toBe("studio");
  expect(setupSoundChoice({ enabled: true, playing: false, track: CLAUDE_FM.id, volume: 0.4 })).toBe(
    "claude-fm",
  );
});

test("picking music plays it: the theme's track, or the one already chosen", () => {
  expect(setupSoundChange("studio", DEFAULT_AMBIENT, "midnight")).toEqual({
    enabled: true,
    playing: true,
    track: "lamplight",
  });
  const onCanopy = { enabled: true, playing: true, track: "canopy", volume: 0.4 };
  expect(setupSoundChange("studio", onCanopy, "midnight").track).toBe("canopy");
  const onFm = { enabled: true, playing: true, track: CLAUDE_FM.id, volume: 0.4 };
  expect(setupSoundChange("studio", onFm, "ocean").track).toBe("tide");
  expect(setupSoundChange("claude-fm", DEFAULT_AMBIENT, "warm")).toEqual({
    enabled: true,
    playing: true,
    track: CLAUDE_FM.id,
  });
  expect(setupSoundChange("off", onCanopy, "warm")).toEqual({ enabled: false, playing: false });
});
