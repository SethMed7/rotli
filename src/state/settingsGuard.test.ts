// Settings survive updates (the owner, 2026-10-01). A file Rotli couldn't
// read, or one a newer Rotli wrote, is never written over this session; a
// file from an older Rotli loads, and every key it held comes back out.

import { afterEach, describe, expect, test } from "bun:test";

import { APP_SETTINGS_KEYS } from "./appSettingsKeys";
import { appSettingsSnapshot, parseSettings, unknownAppSettingsKeys } from "./persist";
import {
  BLOCK,
  noteSettingsRead,
  SETTINGS_VERSION,
  settingsBlock,
  settingsVersionOf,
  settingsWritable,
  unreadable,
} from "./settingsGuard";

afterEach(() => {
  noteSettingsRead("app", "{}");
  noteSettingsRead("vault", "{}");
});

describe("which settings files Rotli may write", () => {
  test("a read that failed, or a newer file, stays as it is; a corrupt one may be replaced", () => {
    expect(settingsBlock(null)).toBe(BLOCK.unreadable);
    expect(settingsBlock(JSON.stringify({ v: SETTINGS_VERSION + 1 }))).toBe(BLOCK.newer);
    expect(settingsBlock(JSON.stringify({ v: SETTINGS_VERSION, theme: "dark" }))).toBeNull();
    // from before `v` existed
    expect(settingsVersionOf(JSON.stringify({ theme: "dark" }))).toBe(1);
    // unparseable: Rust copies it aside before the first write (app_settings.rs)
    expect(settingsBlock("{ not json")).toBeNull();
  });

  test("each file is judged on its own, and a later good read lifts the block", async () => {
    await expect(Promise.reject(new Error("disk")).catch(unreadable("app"))).rejects.toThrow("disk");
    expect(settingsWritable("app")).toBe(false);
    expect(settingsWritable("vault")).toBe(true);
    noteSettingsRead("vault", JSON.stringify({ v: 9 }));
    expect(settingsWritable("vault")).toBe(false);
    noteSettingsRead("app", JSON.stringify({ v: 1 }));
    expect(settingsWritable("app")).toBe(true);
  });
});

describe("a file from another Rotli version", () => {
  test("every key this build writes is one it reads (no key silently dropped)", () => {
    const written = Object.keys(JSON.parse(appSettingsSnapshot()) as Record<string, unknown>);
    expect(written.filter((key) => !APP_SETTINGS_KEYS.has(key))).toEqual([]);
  });

  test("an older file loads, and a newer build's keys ride through untouched", () => {
    // the shape 1.5.0 wrote (synthetic values), plus two keys only a newer build knows
    const older = JSON.stringify({
      v: 1,
      theme: "dark",
      themeFamily: "ocean",
      onboarded: true,
      onboardingVersion: "1.5.0",
      lastSeenVersion: "1.6.0",
      stayOpen: true,
      showInDock: true,
      bindings: { "app.capture": "Alt+Space" },
      ambient: { enabled: true, track: "tide", playing: false },
      futureKnob: { level: 3 },
      anotherNewThing: "kept",
    });
    const parsed = parseSettings(older);
    expect(parsed).toMatchObject({
      theme: "dark",
      themeFamily: "ocean",
      onboarded: true,
      onboardingVersion: "1.5.0",
      lastSeenVersion: "1.6.0",
      stayOpen: true,
      showInDock: true,
    });
    expect(parsed.bindings).toEqual({ "app.capture": "Alt+Space" });
    expect(unknownAppSettingsKeys(older)).toEqual({ futureKnob: { level: 3 }, anotherNewThing: "kept" });
  });
});
