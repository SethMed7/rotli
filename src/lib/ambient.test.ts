import { describe, expect, test } from "bun:test";

import {
  AMBIENT_SOURCES,
  AMBIENT_TRACKS,
  ambientSources,
  ambientSrc,
  CLAUDE_FM,
  DEFAULT_AMBIENT,
  isStream,
  parseAmbient,
  pausedFromOutside,
  playerView,
  stepTrack,
  streamUrl,
  trackForFamily,
  trackTitle,
} from "./ambient";

const on = { enabled: true, track: "tide", playing: true, volume: 0.4, stations: [] };
const off = { ...on, enabled: false };

describe("the ambient preference", () => {
  test("read tolerantly: anything missing or malformed is the default", () => {
    for (const value of [undefined, null, 3, "on", [], {}])
      expect(parseAmbient(value)).toEqual(DEFAULT_AMBIENT);
    // a file saved before stations existed reads with none
    expect(parseAmbient({ enabled: true, track: "dusk", playing: true, volume: 0.25 })).toEqual({
      enabled: true,
      track: "dusk",
      playing: true,
      volume: 0.25,
      stations: [],
    });
    // a volume outside 0–1, or not a number, is the default
    for (const volume of [-0.1, 1.5, "loud", Number.NaN])
      expect(parseAmbient({ enabled: true, track: "dusk", playing: true, volume }).volume).toBe(
        DEFAULT_AMBIENT.volume,
      );
    // a track this build doesn't ship falls back; only a real true turns it on
    expect(parseAmbient({ enabled: "yes", track: "../../etc", playing: 1, volume: 0.4 })).toEqual(
      DEFAULT_AMBIENT,
    );
  });

  test("a saved station is kept, may be the current source, and is checked again on load", () => {
    const station = {
      id: "yt-jfKfPfyJRdk",
      title: "Lofi",
      url: "https://www.youtube.com/watch?v=jfKfPfyJRdk",
    };
    const prefs = parseAmbient({
      enabled: true,
      track: station.id,
      playing: true,
      volume: 0.4,
      stations: [station],
    });
    expect(prefs.stations).toEqual([station]);
    expect(prefs.track).toBe(station.id);
    expect(isStream(prefs.track)).toBe(true);
    expect(streamUrl(prefs, prefs.track)).toBe(station.url);
    expect(trackTitle(prefs.track, prefs)).toBe("Lofi");
    expect(
      ambientSources(prefs)
        .map((source) => source.id)
        .at(-1),
    ).toBe(station.id);
    // a station that no longer parses takes its selection with it
    const tampered = parseAmbient({
      enabled: true,
      track: "yt-jfKfPfyJRdk",
      playing: true,
      volume: 0.4,
      stations: [{ ...station, url: "https://evil.test/watch?v=jfKfPfyJRdk" }],
    });
    expect(tampered.stations).toEqual([]);
    expect(tampered.track).toBe(DEFAULT_AMBIENT.track);
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
    expect(
      parseAmbient({ enabled: true, track: "claude-fm", playing: true, volume: 0.4, stations: [] }).track,
    ).toBe("claude-fm");
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

// A stream page paused from outside Rotli (AirPods, a media key) is the
// person's choice once it holds; a page's own short stall isn't.
test("a stream's outside pause counts once it holds and Rotli didn't ask", () => {
  expect(pausedFromOutside(null, 10_000)).toBe(false);
  expect(pausedFromOutside(500, 10_000)).toBe(false);
  expect(pausedFromOutside(1500, 10_000)).toBe(true);
  // Rotli asked for this pause a moment ago: it's Rotli's, not the person's
  expect(pausedFromOutside(1500, 1000)).toBe(false);
});
