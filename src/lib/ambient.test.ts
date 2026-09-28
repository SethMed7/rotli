import { describe, expect, test } from "bun:test";

import {
  AMBIENT_SOURCES,
  AMBIENT_TRACKS,
  ambientSrc,
  CLAUDE_FM,
  DEFAULT_AMBIENT,
  isStream,
  parseAmbient,
  playerView,
  stepTrack,
  trackForFamily,
  trackTitle,
} from "./ambient";

const on = { enabled: true, track: "tide", playing: true };
const off = { ...on, enabled: false };

describe("the ambient preference", () => {
  test("read tolerantly: anything missing or malformed is the default", () => {
    for (const value of [undefined, null, 3, "on", [], {}])
      expect(parseAmbient(value)).toEqual(DEFAULT_AMBIENT);
    expect(parseAmbient({ enabled: true, track: "dusk", playing: true })).toEqual({
      enabled: true,
      track: "dusk",
      playing: true,
    });
    // a track this build doesn't ship falls back; only a real true turns it on
    expect(parseAmbient({ enabled: "yes", track: "../../etc", playing: 1 })).toEqual(DEFAULT_AMBIENT);
  });

  test("six tracks, one per theme family, each a bundled file", () => {
    expect(AMBIENT_TRACKS.map((t) => t.id)).toEqual([
      "linen",
      "graphite",
      "tide",
      "canopy",
      "dusk",
      "lamplight",
    ]);
    expect(trackForFamily("ocean")).toBe("tide");
    expect(trackForFamily("midnight")).toBe("lamplight");
    expect(trackForFamily("blossom")).toBe("linen");
    expect(ambientSrc("tide")).toBe("/ambient/tide.m4a");
    expect(ambientSrc("tide", "/app/")).toBe("/app/ambient/tide.m4a");
  });

  test("skipping wraps around the list", () => {
    expect(stepTrack("linen", 1)).toBe("graphite");
    expect(stepTrack("linen", -1)).toBe("lamplight");
    expect(stepTrack("lamplight", 1)).toBe("linen");
    // from Claude FM (a live stream), Next is the first track, Previous the last
    expect(stepTrack(CLAUDE_FM.id, 1)).toBe("linen");
    expect(stepTrack(CLAUDE_FM.id, -1)).toBe("lamplight");
  });

  test("Claude FM is a source the preference keeps and the menu offers, last", () => {
    expect(parseAmbient({ enabled: true, track: "claude-fm", playing: true }).track).toBe("claude-fm");
    expect(trackTitle("claude-fm")).toBe("Claude FM");
    expect(isStream("claude-fm")).toBe(true);
    expect(isStream("tide")).toBe(false);
    expect(AMBIENT_SOURCES.map((source) => source.id)).toEqual([
      ...AMBIENT_TRACKS.map((track) => track.id),
      "claude-fm",
    ]);
    expect(CLAUDE_FM.url).toBe("https://clau.de/radio");
  });
});

describe("the player for one moment", () => {
  test("ambient on, nothing in a tab: the player shows ambient, and it plays when wanted", () => {
    expect(playerView(on, {}, null)).toEqual({
      visible: true,
      tab: null,
      tabPlaying: false,
      ambientPlays: true,
      ambientDocked: false,
    });
    expect(playerView({ ...on, playing: false }, {}, null).ambientPlays).toBe(false);
  });

  test("a tab playing takes over: ambient pauses and waits on the left", () => {
    expect(playerView(on, { t1: "playing" }, "t1")).toEqual({
      visible: true,
      tab: "t1",
      tabPlaying: true,
      ambientPlays: false,
      ambientDocked: true,
    });
  });

  test("the tab pauses or closes: ambient comes back", () => {
    // paused: the player stays on the tab (so it can resume), ambient plays
    expect(playerView(on, { t1: "paused" }, "t1")).toMatchObject({
      tab: "t1",
      tabPlaying: false,
      ambientPlays: true,
    });
    // closed: nothing left in a tab
    expect(playerView(on, {}, "t1")).toMatchObject({ tab: null, ambientPlays: true, ambientDocked: false });
  });

  test("ambient off: the player shows only while a tab has media, and never plays ambient", () => {
    expect(playerView(off, {}, null).visible).toBe(false);
    expect(playerView(off, { t1: "playing" }, "t1")).toEqual({
      visible: true,
      tab: "t1",
      tabPlaying: true,
      ambientPlays: false,
      ambientDocked: false,
    });
    expect(playerView(off, { t1: "paused" }, null)).toMatchObject({
      visible: true,
      tab: "t1",
      ambientPlays: false,
    });
  });

  test("the player follows whichever tab is playing, else the one that played last", () => {
    expect(playerView(on, { t1: "paused", t2: "playing" }, "t1").tab).toBe("t2");
    expect(playerView(on, { t1: "paused", t2: "paused" }, "t2").tab).toBe("t2");
    // a suspended page still has media
    expect(playerView(on, { t1: "suspended" }, null)).toMatchObject({ tab: "t1", tabPlaying: false });
  });

  test("Rotli's own audio or video pauses ambient without taking the player", () => {
    expect(playerView(on, {}, null, true)).toMatchObject({ tab: null, ambientPlays: false, visible: true });
  });
});
