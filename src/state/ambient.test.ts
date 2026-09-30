import { beforeEach, describe, expect, test } from "bun:test";

import { DEFAULT_AMBIENT } from "../lib/ambient";
import { forgetTabMedia, setInAppMedia, setTabMedia, useAmbient, useTabMedia } from "./ambient";
import { hydrateAppExtras } from "./appExtras";

beforeEach(() => {
  useTabMedia.setState({ media: {}, recent: null, inApp: false });
  useAmbient.setState({ prefs: { ...DEFAULT_AMBIENT } });
});

describe("what the tabs are playing", () => {
  test("the tab that played last is remembered; a silent page is left out", () => {
    setTabMedia("t1", "playing");
    setTabMedia("t2", "paused");
    expect(useTabMedia.getState()).toMatchObject({ media: { t1: "playing", t2: "paused" }, recent: "t1" });
    setTabMedia("t1", "none");
    expect(useTabMedia.getState()).toMatchObject({ media: { t2: "paused" }, recent: "t1" });
    setTabMedia("t2", "playing");
    expect(useTabMedia.getState().recent).toBe("t2");
  });

  test("an unchanged answer changes nothing (the poll asks every second)", () => {
    setTabMedia("t1", "paused");
    const before = useTabMedia.getState();
    setTabMedia("t1", "paused");
    expect(useTabMedia.getState()).toBe(before);
  });

  test("a closed tab is forgotten, and so is Rotli's own media once it stops", () => {
    setTabMedia("t1", "playing");
    forgetTabMedia("t1");
    expect(useTabMedia.getState()).toMatchObject({ media: {}, recent: null });
    setInAppMedia(true);
    expect(useTabMedia.getState().inApp).toBe(true);
    setInAppMedia(false);
    expect(useTabMedia.getState().inApp).toBe(false);
  });
});

describe("the saved preference", () => {
  test("loaded from the app settings file's text, tolerantly", () => {
    hydrateAppExtras(JSON.stringify({ v: 1, ambient: { enabled: true, track: "dusk", playing: true } }));
    // a file from before volume existed plays at the default
    expect(useAmbient.getState().prefs).toEqual({ enabled: true, track: "dusk", playing: true, volume: 0.4 });
    hydrateAppExtras("not json");
    expect(useAmbient.getState().prefs).toEqual(DEFAULT_AMBIENT);
    useAmbient.getState().setPrefs({ track: "tide" });
    expect(useAmbient.getState().prefs.track).toBe("tide");
  });
});
