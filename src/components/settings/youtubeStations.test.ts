import { expect, test } from "bun:test";

import { DEFAULT_AMBIENT } from "../../lib/ambient";
import { MAX_STATIONS } from "../../lib/youtubeStation";
import { addedStation, removedStation, stationProblem } from "./youtubeStations";

const link = (n: number) => `https://youtu.be/${String(n).repeat(11).slice(0, 11)}`;

test("a YouTube link adds a station and plays it; anything else says why not", () => {
  const prefs = { ...DEFAULT_AMBIENT, enabled: true };
  expect(stationProblem("https://vimeo.com/1", prefs)).toMatch(/isn’t a YouTube/);
  const change = addedStation(link(1), "  Mine ", prefs)!;
  expect(change).toMatchObject({ track: "yt-11111111111", playing: true });
  expect(change.stations).toEqual([
    { id: "yt-11111111111", title: "Mine", url: "https://www.youtube.com/watch?v=11111111111" },
  ]);
  const withOne = { ...prefs, ...change };
  expect(stationProblem(link(1), withOne)).toBe("That station is already here.");
});

test("at most three stations; removing the one playing goes back to Linen", () => {
  let prefs = { ...DEFAULT_AMBIENT, enabled: true };
  for (let n = 1; n <= MAX_STATIONS; n++) prefs = { ...prefs, ...addedStation(link(n), "", prefs)! };
  expect(prefs.stations).toHaveLength(MAX_STATIONS);
  expect(stationProblem(link(9), prefs)).toMatch(/remove one first/);
  expect(addedStation(link(9), "", prefs)).toBeNull();
  const playing = prefs.track;
  expect(removedStation(playing, prefs)).toEqual({
    stations: prefs.stations.filter((station) => station.id !== playing),
    track: DEFAULT_AMBIENT.track,
  });
  expect(removedStation(prefs.stations[0]!.id, prefs)).not.toHaveProperty("track");
});
